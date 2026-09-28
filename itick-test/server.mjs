import http from "node:http";
import WebSocket from "ws";

const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.ITICK_API_KEY || "";
const WS_URL = process.env.ITICK_WS_URL || "wss://api-free.itick.org/stock";
const REST_BASE = process.env.ITICK_REST_BASE || "https://api-free.itick.org";
const REGION = (process.env.ITICK_REGION || "TR").toUpperCase();
const SYMBOLS = (process.env.SYMBOLS || "THYAO,GARAN,ASELS")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const TYPES = process.env.ITICK_TYPES || "quote,tick";

if (!TOKEN) {
  console.error("ITICK_API_KEY missing");
  process.exit(1);
}

const subscriptionParams = SYMBOLS.map(s => `${s}$${REGION}`).join(",");

let latest = {};
let events = [];
let state = {
  service: "iTick BIST live test",
  wsUrl: WS_URL,
  region: REGION,
  symbols: SYMBOLS,
  types: TYPES,
  connected: false,
  authenticated: false,
  subscribed: false,
  lastEventAt: null,
  lastError: null,
  lastControlMessage: null,
  restProbe: null,
  startedAt: new Date().toISOString(),
  reconnects: 0,
  messageCount: 0
};

function pushEvent(e) {
  events.unshift(e);
  if (events.length > 50) events.length = 50;
}

async function probeRest() {
  const url = `${REST_BASE}/stock/quote?region=${encodeURIComponent(REGION)}&code=${encodeURIComponent(SYMBOLS[0])}`;
  try {
    const res = await fetch(url, {
      headers: {accept:"application/json", token:TOKEN}
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    state.restProbe = {status:res.status, ok:res.ok, body, at:new Date().toISOString()};
    console.log("REST probe", res.status, JSON.stringify(body).slice(0,500));
  } catch (err) {
    state.restProbe = {status:null, ok:false, error:String(err?.message || err), at:new Date().toISOString()};
    console.error("REST probe error", state.restProbe.error);
  }
}

function startWs() {
  let ws;
  let pingTimer;
  let subscribeSent = false;

  const subscribe = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || subscribeSent) return;
    subscribeSent = true;
    const payload = {ac:"subscribe", params:subscriptionParams, types:TYPES};
    console.log("SUBSCRIBE", JSON.stringify({...payload, params:`[${SYMBOLS.length} BIST symbols]`}));
    ws.send(JSON.stringify(payload));
  };

  try {
    ws = new WebSocket(WS_URL, {headers:{token:TOKEN}});
  } catch (err) {
    state.lastError = String(err?.message || err);
    setTimeout(startWs, 5000);
    return;
  }

  ws.on("open", () => {
    state.connected = true;
    state.lastError = null;
    console.log("Connected to iTick free WebSocket", WS_URL);
    // Some clusters authenticate directly from the token header and may not
    // emit a separate auth control message, so use a short fallback.
    setTimeout(subscribe, 1200);
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ac:"ping", params:String(Date.now())}));
      }
    }, 25000);
  });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString("utf8")); }
    catch {
      state.lastError = "Non-JSON WebSocket message";
      return;
    }

    if (msg?.resAc || !msg?.data) {
      const safeMsg = JSON.parse(JSON.stringify(msg));
      if (safeMsg?.data?.params && String(safeMsg.data.params).length > 16) {
        safeMsg.data.params = "[REDACTED]";
      }
      state.lastControlMessage = safeMsg;
      console.log("CONTROL", JSON.stringify(safeMsg));
      if (msg?.resAc === "auth" && msg?.code === 1) {
        state.authenticated = true;
        subscribe();
      }
      if (msg?.resAc === "subscribe" && msg?.code === 1) {
        state.subscribed = true;
      }
      if (msg?.code === 0) {
        state.lastError = msg?.msg || JSON.stringify(msg);
      }
      return;
    }

    const d = msg.data || {};
    const symbol = String(d.s || "UNKNOWN").toUpperCase();
    const type = d.type || "unknown";
    const item = {
      symbol,
      region:d.r || REGION,
      exchange:d.e ?? null,
      type,
      last:d.ld ?? d.c ?? null,
      open:d.o ?? null,
      high:d.h ?? null,
      low:d.l ?? null,
      previousClose:d.p ?? null,
      volume:d.v ?? null,
      turnover:d.tu ?? null,
      change:d.ch ?? null,
      changePct:d.chp ?? null,
      timestamp:d.t ?? null,
      bid:Array.isArray(d.b) ? d.b : null,
      ask:Array.isArray(d.a) ? d.a : null,
      receivedAt:new Date().toISOString(),
      raw:d
    };
    latest[symbol] = {...(latest[symbol] || {}), ...item};
    state.messageCount += 1;
    state.lastEventAt = item.receivedAt;
    pushEvent(item);
    console.log("LIVE", symbol, type, item.last, item.volume, item.timestamp);
  });

  ws.on("error", err => {
    state.lastError = String(err?.message || err);
    console.error("iTick WS error", state.lastError);
  });

  ws.on("close", (code, reason) => {
    if (pingTimer) clearInterval(pingTimer);
    state.connected = false;
    state.authenticated = false;
    state.subscribed = false;
    state.reconnects += 1;
    state.lastError = `WebSocket closed ${code}: ${reason?.toString() || ""}`;
    console.error(state.lastError);
    setTimeout(startWs, 5000);
  });
}

http.createServer((req,res) => {
  res.setHeader("content-type","application/json; charset=utf-8");
  res.setHeader("cache-control","no-store");

  if (req.url === "/health") {
    res.statusCode = state.connected ? 200 : 503;
    res.end(JSON.stringify({
      ok:state.connected && (state.subscribed || state.messageCount > 0),
      connected:state.connected,
      authenticated:state.authenticated,
      subscribed:state.subscribed,
      messageCount:state.messageCount,
      lastEventAt:state.lastEventAt,
      lastError:state.lastError,
      restProbe:state.restProbe
    },null,2));
    return;
  }

  res.end(JSON.stringify({...state, latest, recentEvents:events},null,2));
}).listen(PORT,"0.0.0.0",() => {
  console.log("HTTP server listening on", PORT);
});

await probeRest();
startWs();
