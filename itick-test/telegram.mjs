import { analyzeBars } from './indicators.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
const num = (v,d=2) => Number.isFinite(Number(v)) ? new Intl.NumberFormat('tr-TR',{maximumFractionDigits:d}).format(Number(v)) : '-';
const pct = (v) => Number.isFinite(Number(v)) ? `${Number(v)>0?'+':''}${Number(v).toFixed(2)}%` : '-';
const yes = (v) => v ? '✅' : '—';

function money(v){
  const n=Number(v); if(!Number.isFinite(n)) return '-';
  if(Math.abs(n)>=1e9)return `${(n/1e9).toFixed(2)} Mr TL`;
  if(Math.abs(n)>=1e6)return `${(n/1e6).toFixed(2)} Mn TL`;
  return `${num(n,0)} TL`;
}

export class TelegramBot {
  constructor({token,ownerChatId='',provider,alertThreshold=0.7,alertCooldownMin=20}){
    this.token=token; this.ownerChatId=String(ownerChatId||'').trim(); this.provider=provider;
    this.alertThreshold=Number(alertThreshold); this.alertCooldownMs=Number(alertCooldownMin)*60_000;
    this.offset=0; this.running=false; this.alertsEnabled=false; this.alertLast=new Map();
    this.apiBase=token?`https://api.telegram.org/bot${token}`:'';
  }

  isOwner(id){ return Boolean(this.ownerChatId) && String(id)===this.ownerChatId; }

  async api(method,payload={}){
    const res=await fetch(`${this.apiBase}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const body=await res.json().catch(()=>({}));
    if(!res.ok||body?.ok===false) throw new Error(body?.description||`Telegram ${res.status}`);
    return body.result;
  }

  async send(chatId,text){
    return this.api('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true});
  }

  async technical(symbol){
    symbol=String(symbol||'').toUpperCase();
    const q=await this.provider.quote(symbol);
    const bars=await this.provider.dailyBars(symbol);
    return {q,bars,a:analyzeBars(bars,q)};
  }

  async liveTechnical(symbol){
    const q=this.provider.latest[symbol] || await this.provider.quote(symbol);
    const bars=await this.provider.dailyBars(symbol);
    return {q,bars,a:analyzeBars(bars,q)};
  }

  formatFull(symbol,q,a){
    return [
      `📊 <b>${esc(symbol)} — Teknik Analiz</b>`,
      `Fiyat: <b>${num(q.last)}</b> TL | Günlük: <b>${pct(q.changePct)}</b>`,
      `Açılış/Y/D: ${num(q.open)} / ${num(q.high)} / ${num(q.low)}`,
      `Hacim: ${num(q.volume,0)} | Relatif: <b>${num(a.volume.relative,2)}x</b>`,
      '',
      `🎯 Teknik Güç: <b>${a.technicalScore}/100</b>`,
      `RSI14: ${num(a.rsi)} | MACD hist: ${num(a.macd.hist,3)}`,
      `ADX: ${num(a.adx.adx)} | +DI/-DI: ${num(a.adx.plusDI)}/${num(a.adx.minusDI)}`,
      `Stoch: ${num(a.stochastic)} | ROC12: ${pct(a.roc)}`,
      `CCI20: ${num(a.cci)} | Williams %R: ${num(a.williamsR)}`,
      `MFI14: ${num(a.mfi)} | CMF20: ${num(a.cmf,3)}`,
      '',
      `EMA 5/10/20/50: ${num(a.ema.e5)} / ${num(a.ema.e10)} / ${num(a.ema.e20)} / ${num(a.ema.e50)}`,
      `EMA 100/200: ${num(a.ema.e100)} / ${num(a.ema.e200)}`,
      `SMA 20/50/100/200: ${num(a.sma.s20)} / ${num(a.sma.s50)} / ${num(a.sma.s100)} / ${num(a.sma.s200)}`,
      '',
      `Destek20: ${num(a.support)} | Direnç20: ${num(a.resistance)}`,
      `20G kırılım: ${yes(a.breakout20)} | Sıkışma: ${yes(a.squeeze)}`,
      `ATR14: ${num(a.atr)} (${pct(a.atrPct)}) | BB genişlik: ${pct(a.bollinger.bandwidth)}`,
      `52H zirve: ${num(a.high52)} (${pct(a.high52Distance)})`,
      `52H dip: ${num(a.low52)} (${pct(a.low52Distance)})`,
      `OBV: ${num(a.obv,0)}`,
      '',
      `Kaynak: iTick | ${a.bars} günlük bar`
    ].join('\n');
  }

  async scan(kind='score'){
    const out=[];
    for(const symbol of this.provider.symbols){
      try{
        const {q,a}=await this.liveTechnical(symbol);
        out.push({symbol,q,a});
      }catch(err){ out.push({symbol,error:String(err?.message||err)}); }
    }
    if(kind==='score') out.sort((x,y)=>(y.a?.technicalScore||-1)-(x.a?.technicalScore||-1));
    if(kind==='volume') out.sort((x,y)=>(y.a?.volume?.relative||-1)-(x.a?.volume?.relative||-1));
    if(kind==='high') out.sort((x,y)=>(y.a?.high52Distance||-999)-(x.a?.high52Distance||-999));
    return out;
  }

  async handle(chatId,text){
    const [cmdRaw,...args]=String(text||'').trim().split(/\s+/);
    const cmd=(cmdRaw||'').toLowerCase().split('@')[0];

    if(cmd==='/chatid'){
      await this.send(chatId,`Chat ID: <code>${esc(chatId)}</code>`);
      return;
    }

    if(!this.isOwner(chatId)){
      await this.send(chatId,this.ownerChatId
        ? '⛔ Bu bot özel kullanım için sınırlandırılmış.'
        : `🔐 Bot henüz sahibine bağlanmadı.\nChat ID'n: <code>${esc(chatId)}</code>\nRender'da <code>TELEGRAM_OWNER_CHAT_ID</code> olarak ekle.`);
      return;
    }

    if(cmd==='/start'||cmd==='/yardim'){
      await this.send(chatId,
        `🤖 <b>BIST Teknik Tarama Botu</b>\n\n`+
        `/durum — bağlantı durumu\n`+
        `/tara 10 — teknik güç sıralaması\n`+
        `/hisse THYAO — detaylı teknik analiz\n`+
        `/sinyaller 15 — teknik sinyaller\n`+
        `/kirilimlar — 20 günlük direnç kıranlar\n`+
        `/zirve — 52 haftalık zirveye yakınlık\n`+
        `/sikisma — Bollinger/ATR sıkışmaları\n`+
        `/hacim — relatif hacim sıralaması\n`+
        `/canli — anlık üç hisse\n`+
        `/alarmac — otomatik alarm aç\n`+
        `/alarmkapat — otomatik alarm kapat\n`+
        `/test — bot testi\n`+
        `/chatid — chat ID\n`+
        `/kayit — sahip kaydı durumu\n`+
        `/yardim — komutlar\n\n`+
        `<i>iTick Free nedeniyle sürekli WebSocket şu an 3 hissede. Provider değişince komutlar aynı kalacak.</i>`);
      return;
    }

    if(cmd==='/durum'){
      const s=this.provider.status();
      await this.send(chatId,
        `🟢 <b>Sistem Durumu</b>\nProvider: iTick\nWebSocket: ${s.connected?'bağlı ✅':'bağlı değil ❌'}\n`+
        `Abonelik: ${s.subscribed?'aktif ✅':'aktif değil ❌'}\nCanlı semboller: ${esc(s.symbols.join(', '))}\n`+
        `Mesaj: ${num(s.messageCount,0)} | Son event: ${esc(s.lastEventAt||'-')}\nAlarm: ${this.alertsEnabled?'açık':'kapalı'}`);
      return;
    }

    if(cmd==='/test'){
      await this.send(chatId,`✅ Bot çalışıyor. iTick: ${this.provider.status().connected?'bağlı':'bağlı değil'}.`);
      return;
    }

    if(cmd==='/kayit'){
      await this.send(chatId,`✅ Bu chat bot sahibi olarak yetkili. Chat ID: <code>${esc(chatId)}</code>`);
      return;
    }

    if(cmd==='/canli'){
      const rows=this.provider.symbols.map(s=>{
        const q=this.provider.latest[s];
        return q?`${s}: <b>${num(q.last)}</b> TL | ${pct(q.changePct)} | Hacim ${num(q.volume,0)}`:`${s}: veri bekleniyor`;
      });
      await this.send(chatId,`⚡ <b>Canlı WebSocket</b>\n${rows.join('\n')}`);
      return;
    }

    if(cmd==='/hisse'){
      const symbol=String(args[0]||'').toUpperCase();
      if(!symbol){ await this.send(chatId,'Kullanım: <code>/hisse THYAO</code>'); return; }
      try{
        await this.send(chatId,`⏳ ${esc(symbol)} teknik verileri hazırlanıyor...`);
        const {q,a}=await this.technical(symbol);
        await this.send(chatId,this.formatFull(symbol,q,a));
      }catch(err){ await this.send(chatId,`❌ ${esc(err?.message||err)}`); }
      return;
    }

    if(cmd==='/tara'||cmd==='/sinyaller'){
      const requested=Math.max(1,Math.min(30,Number(args[0]||10)));
      const rows=(await this.scan('score')).filter(x=>x.a).slice(0,requested).map((x,i)=>{
        const flags=[
          x.a.breakout20?'KIRILIM':null,
          x.a.volume.relative>=1.5?'HACİM':null,
          x.a.macd.hist>0?'MACD+':null,
          x.a.adx.adx>=25&&x.a.adx.plusDI>x.a.adx.minusDI?'TREND':null
        ].filter(Boolean).join(',');
        return `${i+1}. <b>${x.symbol}</b> — <b>${x.a.technicalScore}/100</b> | ${num(x.q.last)} TL | RSI ${num(x.a.rsi)} | RV ${num(x.a.volume.relative)}x${flags?` | ${flags}`:''}`;
      });
      await this.send(chatId,`🔎 <b>Teknik Güç Taraması</b>\n${rows.join('\n')||'Veri yok'}`);
      return;
    }

    if(cmd==='/kirilimlar'){
      const x=(await this.scan()).filter(x=>x.a?.breakout20);
      await this.send(chatId,`🚀 <b>20 Günlük Kırılımlar</b>\n${x.map(z=>`${z.symbol}: ${num(z.q.last)} > ${num(z.a.resistance)} | Skor ${z.a.technicalScore}`).join('\n')||'Şu an kırılım yok.'}`);
      return;
    }

    if(cmd==='/zirve'){
      const x=(await this.scan('high')).filter(x=>x.a);
      await this.send(chatId,`🏔 <b>52 Haftalık Zirve Yakınlığı</b>\n${x.map(z=>`${z.symbol}: ${num(z.q.last)} TL | zirve ${num(z.a.high52)} | ${pct(z.a.high52Distance)}`).join('\n')}`);
      return;
    }

    if(cmd==='/sikisma'){
      const x=(await this.scan()).filter(x=>x.a?.squeeze || (Number(x.a?.atrPct)||99)<2);
      await this.send(chatId,`🗜 <b>Sıkışma Taraması</b>\n${x.map(z=>`${z.symbol}: BB ${pct(z.a.bollinger.bandwidth)} | ATR ${pct(z.a.atrPct)}`).join('\n')||'Belirgin sıkışma yok.'}`);
      return;
    }

    if(cmd==='/hacim'){
      const x=(await this.scan('volume')).filter(x=>x.a);
      await this.send(chatId,`📈 <b>Relatif Hacim</b>\n${x.map(z=>`${z.symbol}: <b>${num(z.a.volume.relative)}x</b> | hacim ${num(z.a.volume.current,0)}`).join('\n')}`);
      return;
    }

    if(cmd==='/alarmac'){
      this.alertsEnabled=true;
      await this.send(chatId,`🔔 Otomatik alarm açıldı. Momentum eşiği: ${pct(this.alertThreshold)}. Yeni kırılım/hacim/teknik güç koşulları da izlenecek.`);
      return;
    }

    if(cmd==='/alarmkapat'){
      this.alertsEnabled=false; await this.send(chatId,'🔕 Otomatik alarm kapatıldı.'); return;
    }

    await this.send(chatId,'Bilinmeyen komut. /yardim yaz.');
  }

  async maybeAlert(item){
    if(!this.alertsEnabled||!this.ownerChatId||item.type!=='quote') return;
    try{
      const mom=this.provider.momentum(item.symbol,5);
      const bars=await this.provider.dailyBars(item.symbol);
      const a=analyzeBars(bars,item);
      const triggers=[];
      if(Number.isFinite(mom)&&mom>=this.alertThreshold) triggers.push(`5dk ${pct(mom)}`);
      if(a.breakout20) triggers.push('20G KIRILIM');
      if(a.volume.relative>=1.5) triggers.push(`RV ${num(a.volume.relative)}x`);
      if(a.technicalScore>=75) triggers.push(`GÜÇ ${a.technicalScore}`);
      if(a.macd.hist>0&&a.adx.adx>=25&&a.adx.plusDI>a.adx.minusDI) triggers.push('GÜÇLÜ TREND');
      if(!triggers.length) return;
      const key=`${item.symbol}:${triggers.join('|')}`,last=this.alertLast.get(key)||0;
      if(Date.now()-last<this.alertCooldownMs)return;
      this.alertLast.set(key,Date.now());
      await this.send(this.ownerChatId,`🚨 <b>${esc(item.symbol)} Sinyal</b>\nFiyat: <b>${num(item.last)}</b> TL\n${triggers.join(' | ')}`);
    }catch(err){ console.error('alert error',err?.message||err); }
  }

  async start(){
    if(!this.token){ console.log('Telegram disabled: TELEGRAM_BOT_TOKEN missing'); return; }
    this.running=true;
    this.provider.on('quote',(item)=>this.maybeAlert(item));
    try{
      await this.api('setMyCommands',{commands:[
        {command:'durum',description:'Sistem durumunu göster'},
        {command:'tara',description:'Teknik güç taraması'},
        {command:'hisse',description:'Detaylı hisse analizi'},
        {command:'sinyaller',description:'Teknik sinyalleri göster'},
        {command:'kirilimlar',description:'20 günlük kırılımlar'},
        {command:'zirve',description:'52 haftalık zirve yakınlığı'},
        {command:'sikisma',description:'Sıkışma taraması'},
        {command:'hacim',description:'Relatif hacim taraması'},
        {command:'canli',description:'Canlı WebSocket hisseleri'},
        {command:'alarmac',description:'Otomatik alarmı aç'},
        {command:'alarmkapat',description:'Otomatik alarmı kapat'},
        {command:'test',description:'Bot test mesajı'},
        {command:'chatid',description:'Chat ID göster'},
        {command:'kayit',description:'Yetki durumunu göster'},
        {command:'yardim',description:'Tüm komutları göster'}
      ]});
    }catch(err){ console.error('setMyCommands error',err?.message||err); }

    console.log('Telegram polling started');
    while(this.running){
      try{
        const updates=await this.api('getUpdates',{offset:this.offset,timeout:25,allowed_updates:['message']});
        for(const u of updates||[]){
          this.offset=Math.max(this.offset,Number(u.update_id)+1);
          const m=u.message; if(!m?.chat?.id||!m?.text)continue;
          await this.handle(m.chat.id,m.text);
        }
      }catch(err){ console.error('Telegram polling error',err?.message||err); await sleep(3000); }
    }
  }
}
