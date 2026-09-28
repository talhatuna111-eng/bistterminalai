import http from 'node:http';
import { ITickProvider } from './provider.mjs';
import { TelegramBot } from './telegram.mjs';

const PORT = Number(process.env.PORT || 10000);
const SYMBOLS = (process.env.SYMBOLS || 'THYAO,GARAN,ASELS')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 3);

const provider = new ITickProvider({
  token: process.env.ITICK_API_KEY || '',
  wsUrl: process.env.ITICK_WS_URL || 'wss://api-free.itick.org/stock',
  restBase: process.env.ITICK_REST_BASE || 'https://api-free.itick.org',
  region: (process.env.ITICK_REGION || 'TR').toUpperCase(),
  symbols: SYMBOLS,
  types: process.env.ITICK_TYPES || 'quote,tick'
});

const telegram = new TelegramBot({
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  ownerChatId: process.env.TELEGRAM_OWNER_CHAT_ID || '',
  provider,
  alertThreshold: Number(process.env.ALERT_5M_PCT || 0.7),
  alertCooldownMin: Number(process.env.ALERT_COOLDOWN_MIN || 20)
});

http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const s = provider.status();

  if (req.url === '/health') {
    res.statusCode = s.connected && s.subscribed ? 200 : 503;
    res.end(JSON.stringify({
      ok: s.connected && s.subscribed,
      provider: s.provider,
      connected: s.connected,
      subscribed: s.subscribed,
      liveSymbols: SYMBOLS,
      messageCount: s.messageCount,
      lastEventAt: s.lastEventAt,
      lastError: s.lastError,
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      telegramOwnerConfigured: Boolean(process.env.TELEGRAM_OWNER_CHAT_ID)
    }, null, 2));
    return;
  }

  res.end(JSON.stringify({
    service: 'BIST Telegram Scanner',
    provider: s,
    telegram: {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      ownerConfigured: Boolean(process.env.TELEGRAM_OWNER_CHAT_ID),
      alertsEnabled: telegram.alertsEnabled
    },
    latest: provider.latest
  }, null, 2));
}).listen(PORT, '0.0.0.0', () => console.log(`HTTP server listening on ${PORT}`));

provider.start();
telegram.start().catch((err) => console.error('Telegram fatal error', err?.message || err));
