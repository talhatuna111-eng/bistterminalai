import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.LAPLACE_API_KEY;
const BASE_URL = process.env.LAPLACE_BASE_URL || "https://api.getlaplace.com";
const SYMBOLS = (process.env.SYMBOLS || "THYAO,GARAN").split(",").map(s => s.trim()).filter(Boolean);

if (!API_KEY) {
  console.error("LAPLACE_API_KEY missing");
  process.exit(1);
}

let latest = {};
let state = {
  connected: false,
  lastEventAt: null,
  lastError: null,
  httpStatus: null,
  symbols: SYMBOLS,
  startedAt: new Date().toISOString()
};

async function connectLive() {
  while (true) {
    const streamId = crypto.randomUUID();
    const url = `${BASE_URL}/api/v2/stock/price/live?filter=${encodeURIComponent(SYMBOLS.join(","))}&region=tr&stream=${streamId}`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          Accept: "text/event-stream"
        }
      });

      state.httpStatus = res.status;

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0,300)}`);
      }

      state.connected = true;
      state.lastError = null;
      console.log("Connected to Laplace LiveBist:", SYMBOLS.join(","));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) throw new Error("SSE stream ended");

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const msg = JSON.parse(raw);
              const data = msg?.d ?? msg;
              const symbol = data?.s;
              if (symbol) {
                latest[symbol] = data;
                state.lastEventAt = new Date().toISOString();
                console.log("LIVE", symbol, data.p, data.ch, data.d);
              }
            } catch (e) {
              console.error("Parse error:", e.message);
            }
          }
        }
      }
    } catch (e) {
      state.connected = false;
      state.lastError = String(e?.message || e);
      console.error("Laplace stream error:", state.lastError);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

http.createServer((req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    service: "Laplace Live BIST test",
    ...state,
    latest
  }, null, 2));
}).listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on ${PORT}`);
});

connectLive();
