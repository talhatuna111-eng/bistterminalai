import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ITickProvider extends EventEmitter {
  constructor({ token, wsUrl, restBase, region = 'TR', symbols = [], types = 'quote,tick' }) {
    super();
    this.token = token;
    this.wsUrl = wsUrl;
    this.restBase = restBase;
    this.region = region;
    this.symbols = symbols;
    this.types = types;
    this.latest = {};
    this.tickHistory = new Map();
    this.restCache = new Map();
    this.restNextAt = 0;
    this.ws = null;
    this.pingTimer = null;
    this.state = {
      provider: 'iTick', connected: false, authenticated: false, subscribed: false,
      lastEventAt: null, lastError: null, messageCount: 0, reconnects: 0,
      startedAt: new Date().toISOString()
    };
  }

  status() {
    return { ...this.state, symbols: this.symbols, types: this.types };
  }

  normalize(d = {}) {
    return {
      symbol: String(d.s || 'UNKNOWN').toUpperCase(),
      region: d.r || this.region,
      exchange: d.e ?? null,
      type: d.type || 'unknown',
      last: d.ld ?? d.c ?? null,
      open: d.o ?? null,
      high: d.h ?? null,
      low: d.l ?? null,
      previousClose: d.p ?? null,
      volume: d.v ?? null,
      turnover: d.tu ?? null,
      change: d.ch ?? null,
      changePct: d.chp ?? null,
      timestamp: d.t ?? null,
      bid: Array.isArray(d.b) ? d.b : null,
      ask: Array.isArray(d.a) ? d.a : null,
      receivedAt: new Date().toISOString()
    };
  }

  record(item) {
    const prev = this.latest[item.symbol] || {};
    this.latest[item.symbol] = { ...prev, ...item };
    this.state.messageCount += 1;
    this.state.lastEventAt = item.receivedAt;

    if (item.type === 'tick' && Number.isFinite(Number(item.last))) {
      const arr = this.tickHistory.get(item.symbol) || [];
      arr.push({ t: Date.now(), p: Number(item.last), v: Number(item.volume || 0) });
      const cutoff = Date.now() - 15 * 60 * 1000;
      while (arr.length && arr[0].t < cutoff) arr.shift();
      if (arr.length > 3000) arr.splice(0, arr.length - 3000);
      this.tickHistory.set(item.symbol, arr);
    }

    this.emit('market', item);
    this.emit(item.type, item);
  }

  momentum(symbol, minutes = 5) {
    const arr = this.tickHistory.get(symbol) || [];
    if (arr.length < 2) return null;
    const cutoff = Date.now() - minutes * 60 * 1000;
    const recent = arr.filter((x) => x.t >= cutoff);
    if (recent.length < 2) return null;
    const first = recent[0].p;
    const last = recent[recent.length - 1].p;
    if (!first) return null;
    return ((last / first) - 1) * 100;
  }

  async quote(symbol, { preferLive = true } = {}) {
    symbol = String(symbol || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(symbol)) throw new Error('Geçersiz sembol');

    const live = this.latest[symbol];
    if (preferLive && live?.type === 'quote' && live?.last != null) {
      return { ...live, source: 'websocket' };
    }

    const cached = this.restCache.get(symbol);
    if (cached && Date.now() - cached.at < 12_000) return { ...cached.data, source: 'rest-cache' };

    const wait = this.restNextAt - Date.now();
    if (wait > 0) await sleep(wait);
    this.restNextAt = Date.now() + 12_500;

    const url = `${this.restBase}/stock/quote?region=${encodeURIComponent(this.region)}&code=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { headers: { accept: 'application/json', token: this.token } });
    const body = await res.json().catch(async () => ({ code: -1, msg: await res.text().catch(() => '') }));
    if (!res.ok || body?.code !== 0 || !body?.data) {
      throw new Error(body?.msg || `iTick HTTP ${res.status}`);
    }
    const item = this.normalize(body.data);
    this.restCache.set(symbol, { at: Date.now(), data: item });
    return { ...item, source: 'rest' };
  }

  start() {
    if (!this.token) throw new Error('ITICK_API_KEY missing');
    this.connect();
  }

  connect() {
    const params = this.symbols.map((s) => `${s}$${this.region}`).join(',');
    let subscribeSent = false;

    const subscribe = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || subscribeSent) return;
      subscribeSent = true;
      this.ws.send(JSON.stringify({ ac: 'subscribe', params, types: this.types }));
      console.log(`iTick subscribe requested for ${this.symbols.length} symbols`);
    };

    this.ws = new WebSocket(this.wsUrl, { headers: { token: this.token } });

    this.ws.on('open', () => {
      this.state.connected = true;
      this.state.lastError = null;
      console.log('Connected to iTick WebSocket');
      setTimeout(subscribe, 1200);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ ac: 'ping', params: String(Date.now()) }));
        }
      }, 25_000);
    });

    this.ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); }
      catch { this.state.lastError = 'Non-JSON WebSocket message'; return; }

      if (msg?.resAc || !msg?.data) {
        const safe = JSON.parse(JSON.stringify(msg));
        if (safe?.data?.params && String(safe.data.params).length > 16) safe.data.params = '[REDACTED]';
        console.log('iTick control', JSON.stringify(safe));
        if (msg?.resAc === 'auth' && msg?.code === 1) {
          this.state.authenticated = true;
          subscribe();
        }
        if (msg?.resAc === 'subscribe') {
          this.state.subscribed = msg?.code === 1;
          if (msg?.code === 0) this.state.lastError = msg?.msg || 'subscription failed';
        }
        return;
      }

      this.record(this.normalize(msg.data));
    });

    this.ws.on('error', (err) => {
      this.state.lastError = String(err?.message || err);
      console.error('iTick WS error', this.state.lastError);
    });

    this.ws.on('close', (code, reason) => {
      clearInterval(this.pingTimer);
      this.state.connected = false;
      this.state.authenticated = false;
      this.state.subscribed = false;
      this.state.reconnects += 1;
      this.state.lastError = `WebSocket closed ${code}: ${reason?.toString() || ''}`;
      console.error(this.state.lastError);
      setTimeout(() => this.connect(), 5000);
    });
  }
}
