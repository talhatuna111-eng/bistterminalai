const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function num(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(n);
}

function pct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} Mr TL`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)} Mn TL`;
  return `${num(n, 0)} TL`;
}

export class TelegramBot {
  constructor({ token, ownerChatId = '', provider, alertThreshold = 0.7, alertCooldownMin = 20 }) {
    this.token = token;
    this.ownerChatId = String(ownerChatId || '').trim();
    this.provider = provider;
    this.alertThreshold = Number(alertThreshold);
    this.alertCooldownMs = Number(alertCooldownMin) * 60_000;
    this.offset = 0;
    this.running = false;
    this.alertsEnabled = false;
    this.alertLast = new Map();
    this.apiBase = token ? `https://api.telegram.org/bot${token}` : '';
  }

  isOwner(chatId) {
    if (!this.ownerChatId) return false;
    return String(chatId) === this.ownerChatId;
  }

  async api(method, payload = {}) {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) throw new Error(body?.description || `Telegram ${res.status}`);
    return body.result;
  }

  async send(chatId, text) {
    return this.api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  formatQuote(q) {
    const mom5 = this.provider.momentum(q.symbol, 5);
    return [
      `📊 <b>${esc(q.symbol)}</b>`,
      `Fiyat: <b>${num(q.last)}</b> TL`,
      `Günlük: <b>${pct(q.changePct)}</b>`,
      `Açılış: ${num(q.open)} | Yüksek: ${num(q.high)} | Düşük: ${num(q.low)}`,
      `Hacim: ${num(q.volume, 0)}`,
      `İşlem tutarı: ${money(q.turnover)}`,
      `5 dk momentum: ${pct(mom5)}`,
      `Kaynak: iTick ${q.source === 'websocket' ? 'canlı WebSocket' : 'REST'}`
    ].join('\n');
  }

  score(symbol) {
    const q = this.provider.latest[symbol];
    if (!q) return null;
    const day = Number(q.changePct || 0);
    const mom = Number(this.provider.momentum(symbol, 5) || 0);
    let score = 50 + Math.max(-20, Math.min(20, day * 4)) + Math.max(-25, Math.min(25, mom * 12));
    score = Math.max(0, Math.min(100, Math.round(score)));
    return { symbol, score, day, mom, price: q.last, volume: q.volume };
  }

  async handle(chatId, text) {
    const [cmdRaw, ...args] = String(text || '').trim().split(/\s+/);
    const cmd = (cmdRaw || '').toLowerCase().split('@')[0];

    if (cmd === '/chatid') {
      await this.send(chatId, `Chat ID: <code>${esc(chatId)}</code>`);
      return;
    }

    if (!this.isOwner(chatId)) {
      await this.send(chatId, this.ownerChatId
        ? '⛔ Bu bot özel kullanım için sınırlandırılmış.'
        : `🔐 Bot henüz sahibine bağlanmadı.\nChat ID'n: <code>${esc(chatId)}</code>\nBu ID Render'da <code>TELEGRAM_OWNER_CHAT_ID</code> olarak tanımlanmalı.`);
      return;
    }

    if (cmd === '/start' || cmd === '/yardim') {
      await this.send(chatId,
        `🤖 <b>BIST Canlı Tarama Botu</b>\n\n` +
        `/canli — WebSocket'teki canlı hisseler\n` +
        `/hisse THYAO — herhangi bir BIST hissesi\n` +
        `/tara — canlı 3 hisseyi momentum skoruyla sırala\n` +
        `/sinyaller — /tara ile aynı\n` +
        `/durum — veri bağlantısı ve bot durumu\n` +
        `/alarmac — momentum alarmını aç\n` +
        `/alarmkapat — alarmı kapat\n` +
        `/chatid — Telegram chat ID`);
      return;
    }

    if (cmd === '/durum') {
      const s = this.provider.status();
      await this.send(chatId,
        `🟢 <b>Sistem Durumu</b>\n` +
        `Provider: iTick\n` +
        `WebSocket: ${s.connected ? 'bağlı ✅' : 'bağlı değil ❌'}\n` +
        `Abonelik: ${s.subscribed ? 'aktif ✅' : 'aktif değil ❌'}\n` +
        `Canlı semboller: ${esc(s.symbols.join(', '))}\n` +
        `Mesaj sayısı: ${num(s.messageCount, 0)}\n` +
        `Son event: ${esc(s.lastEventAt || '-')}\n` +
        `Alarm: ${this.alertsEnabled ? 'açık' : 'kapalı'}`);
      return;
    }

    if (cmd === '/canli') {
      const rows = [];
      for (const symbol of this.provider.symbols) {
        const q = this.provider.latest[symbol];
        rows.push(q
          ? `${symbol}: <b>${num(q.last)}</b> TL | ${pct(q.changePct)} | Hacim ${num(q.volume, 0)}`
          : `${symbol}: veri bekleniyor`);
      }
      await this.send(chatId, `⚡ <b>Canlı iTick</b>\n${rows.join('\n')}`);
      return;
    }

    if (cmd === '/hisse') {
      const symbol = String(args[0] || '').toUpperCase();
      if (!symbol) {
        await this.send(chatId, 'Kullanım: <code>/hisse THYAO</code>');
        return;
      }
      try {
        const q = await this.provider.quote(symbol);
        await this.send(chatId, this.formatQuote(q));
      } catch (err) {
        await this.send(chatId, `❌ ${esc(err?.message || err)}`);
      }
      return;
    }

    if (cmd === '/tara' || cmd === '/sinyaller') {
      const scores = this.provider.symbols.map((s) => this.score(s)).filter(Boolean).sort((a, b) => b.score - a.score);
      if (!scores.length) {
        await this.send(chatId, 'Canlı veri henüz birikmedi.');
        return;
      }
      const rows = scores.map((x, i) =>
        `${i + 1}. <b>${x.symbol}</b> — ${x.score}/100 | ${num(x.price)} TL | gün ${pct(x.day)} | 5dk ${pct(x.mom)}`);
      await this.send(chatId, `🔎 <b>Canlı Momentum Taraması</b>\n${rows.join('\n')}\n\n<i>Skor yalnızca teknik/momentum göstergesidir.</i>`);
      return;
    }

    if (cmd === '/alarmac') {
      this.alertsEnabled = true;
      await this.send(chatId, `🔔 Momentum alarmı açıldı. 5 dk hareket eşiği: ${pct(this.alertThreshold)}`);
      return;
    }

    if (cmd === '/alarmkapat') {
      this.alertsEnabled = false;
      await this.send(chatId, '🔕 Momentum alarmı kapatıldı.');
      return;
    }

    await this.send(chatId, 'Bilinmeyen komut. /yardim yaz.');
  }

  async maybeAlert(item) {
    if (!this.alertsEnabled || !this.ownerChatId || item.type !== 'quote') return;
    const mom = this.provider.momentum(item.symbol, 5);
    if (!Number.isFinite(mom) || mom < this.alertThreshold) return;
    const key = item.symbol;
    const last = this.alertLast.get(key) || 0;
    if (Date.now() - last < this.alertCooldownMs) return;
    this.alertLast.set(key, Date.now());
    try {
      await this.send(this.ownerChatId,
        `🚨 <b>Momentum Alarmı — ${esc(item.symbol)}</b>\n` +
        `Fiyat: <b>${num(item.last)}</b> TL\n` +
        `5 dk: <b>${pct(mom)}</b>\n` +
        `Günlük: ${pct(item.changePct)}\n` +
        `Hacim: ${num(item.volume, 0)}`);
    } catch (err) {
      console.error('Telegram alert error', err?.message || err);
    }
  }

  async start() {
    if (!this.token) {
      console.log('Telegram disabled: TELEGRAM_BOT_TOKEN missing');
      return;
    }
    this.running = true;
    this.provider.on('quote', (item) => this.maybeAlert(item));

    try {
      await this.api('setMyCommands', { commands: [
        { command: 'canli', description: 'Canlı WebSocket hisseleri' },
        { command: 'hisse', description: 'Bir BIST hissesini sorgula' },
        { command: 'tara', description: 'Canlı momentum taraması' },
        { command: 'durum', description: 'Sistem durumunu göster' },
        { command: 'alarmac', description: 'Momentum alarmını aç' },
        { command: 'alarmkapat', description: 'Momentum alarmını kapat' },
        { command: 'chatid', description: 'Telegram chat ID göster' },
        { command: 'yardim', description: 'Komutları göster' }
      ] });
    } catch (err) {
      console.error('setMyCommands error', err?.message || err);
    }

    console.log('Telegram polling started');
    while (this.running) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message']
        });
        for (const u of updates || []) {
          this.offset = Math.max(this.offset, Number(u.update_id) + 1);
          const msg = u.message;
          if (!msg?.chat?.id || !msg?.text) continue;
          await this.handle(msg.chat.id, msg.text);
        }
      } catch (err) {
        console.error('Telegram polling error', err?.message || err);
        await sleep(3000);
      }
    }
  }
}
