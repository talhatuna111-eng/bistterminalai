import http from "node:http";
import crypto from "node:crypto";
import mqtt from "mqtt";

const PORT = Number(process.env.PORT || 10000);
const SYMBOLS = (process.env.SYMBOLS || "THYAO,GARAN,ASELS")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const BROKER_URL = process.env.MATRIKS_MQTT_URL || "";
const USERNAME = process.env.MATRIKS_MQTT_USERNAME || undefined;
const PASSWORD = process.env.MATRIKS_MQTT_PASSWORD || undefined;
const TOPIC_TEMPLATE = process.env.MATRIKS_TOPIC_TEMPLATE || "";
const EXPLICIT_TOPICS = (process.env.MATRIKS_SUBSCRIPTION_TOPICS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const QOS = Math.min(2, Math.max(0, Number(process.env.MATRIKS_MQTT_QOS || 0)));
const REJECT_UNAUTHORIZED = String(process.env.MATRIKS_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false";

function buildTopics() {
  if (EXPLICIT_TOPICS.length) return EXPLICIT_TOPICS;
  if (!TOPIC_TEMPLATE) return [];
  if (!TOPIC_TEMPLATE.includes("{symbol}")) return [TOPIC_TEMPLATE];
  return SYMBOLS.map((symbol) => TOPIC_TEMPLATE.replaceAll("{symbol}", symbol));
}

const topics = buildTopics();

let latest = {};
let state = {
  service: "Matriks Live BIST adapter",
  status: "starting",
  connected: false,
  authenticated: false,
  symbols: SYMBOLS,
  topicCount: topics.length,
  lastEventAt: null,
  lastError: null,
  messages: 0,
  startedAt: new Date().toISOString()
};

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function normalizeMessage(topic, payload) {
  const text = payload.toString("utf8");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 1000) };
  }

  const root = data?.data ?? data?.d ?? data;
  const symbol =
    firstDefined(root, ["symbol", "Symbol", "SYMBOL", "sembol", "SEMBOL", "s", "code", "Code"]) ||
    SYMBOLS.find((s) => topic.toUpperCase().includes(s));

  const price = firstDefined(root, [
    "price", "Price", "PRICE", "last", "Last", "LAST", "lastPrice", "LastPrice",
    "son", "SON", "kapanis", "KAPANIS", "p"
  ]);
  const volume = firstDefined(root, [
    "volume", "Volume", "VOLUME", "vol", "Vol", "VOL", "hacim", "HACIM", "v"
  ]);
  const bid = firstDefined(root, ["bid", "Bid", "BID", "alis", "ALIS"]);
  const ask = firstDefined(root, ["ask", "Ask", "ASK", "satis", "SATIS"]);
  const timestamp = firstDefined(root, [
    "timestamp", "Timestamp", "TIMESTAMP", "time", "Time", "TIME", "date", "Date", "DATE", "t"
  ]);

  return {
    topic,
    symbol: symbol ? String(symbol).toUpperCase() : null,
    price,
    volume,
    bid,
    ask,
    timestamp,
    receivedAt: new Date().toISOString(),
    data: root
  };
}

function startMqtt() {
  if (!BROKER_URL) {
    state.status = "waiting_for_credentials";
    state.lastError = "MATRIKS_MQTT_URL is not configured";
    console.log("Waiting for official Matriks MQTT connection details.");
    return;
  }

  if (!topics.length) {
    state.status = "waiting_for_topic_config";
    state.lastError = "Set MATRIKS_SUBSCRIPTION_TOPICS or MATRIKS_TOPIC_TEMPLATE from the official Matriks API documentation.";
    console.log(state.lastError);
    return;
  }

  state.status = "connecting";
  state.lastError = null;

  const client = mqtt.connect(BROKER_URL, {
    clientId: process.env.MATRIKS_CLIENT_ID || `bist30-${crypto.randomUUID()}`,
    username: USERNAME,
    password: PASSWORD,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 5000,
    connectTimeout: 15000,
    rejectUnauthorized: REJECT_UNAUTHORIZED
  });

  client.on("connect", () => {
    state.connected = true;
    state.authenticated = true;
    state.status = "connected";
    state.lastError = null;
    console.log("Connected to official Matriks MQTT feed.");

    client.subscribe(topics, { qos: QOS }, (err, granted) => {
      if (err) {
        state.lastError = `Subscribe error: ${err.message}`;
        console.error(state.lastError);
        return;
      }
      console.log("Subscribed:", granted?.map((x) => x.topic).join(", ") || topics.join(", "));
    });
  });

  client.on("message", (topic, payload) => {
    try {
      const msg = normalizeMessage(topic, payload);
      state.messages += 1;
      state.lastEventAt = msg.receivedAt;
      const key = msg.symbol || topic;
      latest[key] = msg;
      console.log("LIVE", key, msg.price ?? "-", msg.volume ?? "-");
    } catch (err) {
      state.lastError = `Parse error: ${err?.message || err}`;
      console.error(state.lastError);
    }
  });

  client.on("reconnect", () => {
    state.connected = false;
    state.status = "reconnecting";
  });

  client.on("offline", () => {
    state.connected = false;
    state.status = "offline";
  });

  client.on("close", () => {
    state.connected = false;
    if (state.status === "connected") state.status = "closed";
  });

  client.on("error", (err) => {
    state.connected = false;
    state.authenticated = false;
    state.status = "error";
    state.lastError = String(err?.message || err);
    console.error("Matriks MQTT error:", state.lastError);
  });
}

http.createServer((req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");

  if (req.url === "/health") {
    res.statusCode = state.status === "error" ? 503 : 200;
    res.end(JSON.stringify({
      ok: state.connected,
      status: state.status,
      lastEventAt: state.lastEventAt,
      lastError: state.lastError
    }));
    return;
  }

  res.end(JSON.stringify({
    ...state,
    latest
  }, null, 2));
}).listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on ${PORT}`);
});

startMqtt();
