// Relay for Muse Voice Transcribe. Muse takes the API key in the first
// WebSocket frame and offers no browser token, so the browser connects here
// and the relay adds the key before forwarding everything both ways.
//
//   node --env-file=.env scripts/asr-relay.mjs
//
// ASR_RELAY_ORIGINS (comma-separated) limits which pages may use it; the
// default allows only localhost.
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.ASR_RELAY_PORT ?? process.env.PORT ?? 8787);
const UPSTREAM = 'wss://api.meta.ai/v1/asr/realtime';
const ORIGINS = (process.env.ASR_RELAY_ORIGINS ?? 'http://localhost:3000').split(',');
const MAX_SESSION_MS = 5 * 60 * 1000; // a hotel call is short; caps spend if a tab is left open

if (!process.env.META_API_KEY) throw new Error('META_API_KEY not set');

const wss = new WebSocketServer({
  port: PORT,
  verifyClient: ({ origin }) => ORIGINS.includes(origin),
});

wss.on('connection', (client) => {
  const upstream = new WebSocket(UPSTREAM);
  const pending = [];
  let handshakeSent = false;
  const timer = setTimeout(() => client.close(1000, 'session limit'), MAX_SESSION_MS);

  const toUpstream = (data, isBinary) => {
    if (!handshakeSent) {
      // Only the model and settings come from the browser; the key and the
      // model id are set here so the relay can't be used for anything else.
      const hs = JSON.parse(String(data));
      upstream.send(JSON.stringify({
        ...hs,
        model: 'muse-voice-transcribe-1.0',
        authorization: { accessToken: `Bearer ${process.env.META_API_KEY}` },
      }));
      handshakeSent = true;
    } else {
      upstream.send(data, { binary: isBinary });
    }
  };

  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) toUpstream(data, isBinary);
    else pending.push([data, isBinary]);
  });
  upstream.on('open', () => { for (const [d, b] of pending.splice(0)) toUpstream(d, b); });
  upstream.on('message', (data, isBinary) => client.readyState === WebSocket.OPEN && client.send(data, { binary: isBinary }));

  const closeBoth = (code, reason) => {
    clearTimeout(timer);
    const c = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000;
    if (client.readyState === WebSocket.OPEN) client.close(c, reason);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  };
  upstream.on('close', (code, reason) => closeBoth(code, String(reason)));
  upstream.on('error', (e) => closeBoth(1011, e.message.slice(0, 100)));
  client.on('close', () => closeBoth(1000, ''));
  client.on('error', () => closeBoth(1000, ''));
});

console.log(`ASR relay on ws://localhost:${PORT} for ${ORIGINS.join(', ')}`);
