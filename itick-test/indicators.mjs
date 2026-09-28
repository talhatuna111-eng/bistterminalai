const n = (v) => Number(v);
const finite = (v) => Number.isFinite(n(v));
const avg = (a) => a.length ? a.reduce((s,x)=>s+n(x),0)/a.length : null;
const tail = (a,k) => a.slice(Math.max(0,a.length-k));

export function sma(vals,p){ if(vals.length<p)return null; return avg(tail(vals,p)); }
export function ema(vals,p){ if(vals.length<p)return null; const k=2/(p+1); let e=avg(vals.slice(0,p)); for(let i=p;i<vals.length;i++) e=n(vals[i])*k+e*(1-k); return e; }
export function rsi(vals,p=14){ if(vals.length<=p)return null; let g=0,l=0; for(let i=vals.length-p;i<vals.length;i++){const d=n(vals[i])-n(vals[i-1]); if(d>=0)g+=d; else l-=d;} if(l===0)return 100; const rs=(g/p)/(l/p); return 100-(100/(1+rs)); }
export function roc(vals,p=12){ if(vals.length<=p)return null; const a=n(vals[vals.length-1-p]),b=n(vals.at(-1)); return a?((b/a)-1)*100:null; }
export function macd(vals){ const e12=ema(vals,12),e26=ema(vals,26); if(e12==null||e26==null||vals.length<35)return {macd:null,signal:null,hist:null}; const series=[]; for(let i=26;i<=vals.length;i++){const s=vals.slice(0,i);series.push(ema(s,12)-ema(s,26));} const signal=ema(series,9); const m=e12-e26; return {macd:m,signal,hist:signal==null?null:m-signal}; }
export function atr(bars,p=14){ if(bars.length<=p)return null; const tr=[]; for(let i=1;i<bars.length;i++){const h=n(bars[i].h),l=n(bars[i].l),pc=n(bars[i-1].c);tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));} return avg(tail(tr,p)); }
export function bollinger(vals,p=20,m=2){ if(vals.length<p)return {mid:null,upper:null,lower:null,bandwidth:null}; const x=tail(vals,p),mid=avg(x),sd=Math.sqrt(avg(x.map(v=>(n(v)-mid)**2))); return {mid,upper:mid+m*sd,lower:mid-m*sd,bandwidth:mid?((2*m*sd)/mid)*100:null}; }
export function stochastic(bars,p=14){ if(bars.length<p)return null; const x=tail(bars,p),hh=Math.max(...x.map(b=>n(b.h))),ll=Math.min(...x.map(b=>n(b.l))),c=n(x.at(-1).c); return hh===ll?50:((c-ll)/(hh-ll))*100; }
export function williamsR(bars,p=14){ const k=stochastic(bars,p); return k==null?null:k-100; }
export function cci(bars,p=20){ if(bars.length<p)return null; const x=tail(bars,p),tp=x.map(b=>(n(b.h)+n(b.l)+n(b.c))/3),m=avg(tp),md=avg(tp.map(v=>Math.abs(v-m))); return md? (tp.at(-1)-m)/(0.015*md):0; }
export function obv(bars){ let v=0; for(let i=1;i<bars.length;i++){const c=n(bars[i].c),pc=n(bars[i-1].c),vol=n(bars[i].v||0); if(c>pc)v+=vol; else if(c<pc)v-=vol;} return v; }
export function cmf(bars,p=20){ if(bars.length<p)return null; const x=tail(bars,p); let mf=0,vol=0; for(const b of x){const h=n(b.h),l=n(b.l),c=n(b.c),v=n(b.v||0); const mult=h===l?0:((c-l)-(h-c))/(h-l); mf+=mult*v;vol+=v;} return vol?mf/vol:null; }
export function mfi(bars,p=14){ if(bars.length<=p)return null; const x=bars.slice(-(p+1)); let pos=0,neg=0; for(let i=1;i<x.length;i++){const tp=(n(x[i].h)+n(x[i].l)+n(x[i].c))/3, ptp=(n(x[i-1].h)+n(x[i-1].l)+n(x[i-1].c))/3, flow=tp*n(x[i].v||0); if(tp>=ptp)pos+=flow; else neg+=flow;} if(!neg)return 100; const r=pos/neg; return 100-(100/(1+r)); }
export function adx(bars,p=14){ if(bars.length<p+2)return {adx:null,plusDI:null,minusDI:null}; const trs=[],plus=[],minus=[]; for(let i=1;i<bars.length;i++){const h=n(bars[i].h),l=n(bars[i].l),ph=n(bars[i-1].h),pl=n(bars[i-1].l),pc=n(bars[i-1].c); trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc))); const up=h-ph,down=pl-l; plus.push(up>down&&up>0?up:0);minus.push(down>up&&down>0?down:0);} const tr=avg(tail(trs,p)),pd=avg(tail(plus,p)),md=avg(tail(minus,p)); if(!tr)return {adx:null,plusDI:null,minusDI:null}; const pdi=100*pd/tr,mdi=100*md/tr,dx=(pdi+mdi)?100*Math.abs(pdi-mdi)/(pdi+mdi):0; return {adx:dx,plusDI:pdi,minusDI:mdi}; }

export function analyzeBars(bars, liveQuote=null){
  bars=[...bars].filter(b=>finite(b.c)&&finite(b.h)&&finite(b.l)).sort((a,b)=>n(a.t)-n(b.t));
  if(bars.length<20) throw new Error('Yetersiz tarihsel veri');
  const closes=bars.map(b=>n(b.c)), vols=bars.map(b=>n(b.v||0));
  const price=finite(liveQuote?.last)?n(liveQuote.last):closes.at(-1);
  const e5=ema(closes,5),e10=ema(closes,10),e20=ema(closes,20),e50=ema(closes,50),e100=ema(closes,100),e200=ema(closes,200);
  const s20=sma(closes,20),s50=sma(closes,50),s100=sma(closes,100),s200=sma(closes,200);
  const R=rsi(closes,14),M=macd(closes),A=adx(bars,14),AT=atr(bars,14),BB=bollinger(closes,20,2);
  const look20=bars.slice(-21,-1),res20=look20.length?Math.max(...look20.map(b=>n(b.h))):null,sup20=look20.length?Math.min(...look20.map(b=>n(b.l))):null;
  const y=tail(bars,252),hi52=Math.max(...y.map(b=>n(b.h))),lo52=Math.min(...y.map(b=>n(b.l)));
  const av20=avg(tail(vols.slice(0,-1),20)),curVol=finite(liveQuote?.volume)?n(liveQuote.volume):vols.at(-1),relVol=av20?curVol/av20:null;
  let score=50;
  if(e20!=null) score += price>e20?7:-7;
  if(e50!=null) score += price>e50?7:-7;
  if(e200!=null) score += price>e200?8:-8;
  if(R!=null) score += R>=55&&R<=75?8:R<40?-6:0;
  if(M.hist!=null) score += M.hist>0?8:-8;
  if(A.adx!=null&&A.adx>=25) score += A.plusDI>A.minusDI?8:-8;
  if(relVol!=null&&relVol>=1.5) score += 7;
  if(res20!=null&&price>res20) score += 10;
  score=Math.max(0,Math.min(100,Math.round(score)));
  return {
    price, ema:{e5,e10,e20,e50,e100,e200}, sma:{s20,s50,s100,s200}, rsi:R, macd:M, adx:A,
    atr:AT, atrPct:AT&&price?AT/price*100:null, bollinger:BB, stochastic:stochastic(bars,14),
    roc:roc(closes,12), cci:cci(bars,20), williamsR:williamsR(bars,14), obv:obv(bars),
    cmf:cmf(bars,20), mfi:mfi(bars,14), volume:{current:curVol,avg20:av20,relative:relVol},
    support:sup20,resistance:res20, breakout20:res20!=null&&price>res20,
    high52:hi52,low52:lo52,high52Distance:hi52?((price/hi52)-1)*100:null,
    low52Distance:lo52?((price/lo52)-1)*100:null, technicalScore:score,
    squeeze:BB.bandwidth!=null&&BB.bandwidth<8, bars:bars.length
  };
}
