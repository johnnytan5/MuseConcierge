// Streams a bench clip through the ASR relay in real time and prints what
// Muse heard, so a deployed relay can be checked without a browser or mic.
//
//   node scripts/relay-check.mjs [relay-url] [clip] [origin]
//   node scripts/relay-check.mjs wss://brain.saveds.page/muse-asr
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';

const [url = 'ws://localhost:8787', clip = 'bench/clips/02.wav', origin = 'http://localhost:3000'] = process.argv.slice(2);
const wav = readFileSync(clip);
const pcm = wav.subarray(wav.indexOf('data') + 8); // 16 kHz mono PCM16, as the bench clips are
const FRAME = 2560; // 80 ms, like the browser mic worklet
const started = Date.now();
const t = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

const ws = new WebSocket(url, { headers: { Origin: origin } });
ws.on('unexpected-response', (_req, res) => { console.log(`refused: HTTP ${res.statusCode} (origin ${origin} not allowed?)`); process.exit(1); });
ws.on('error', (e) => { console.log(`error: ${e.message}`); process.exit(1); });
ws.on('open', () => {
  console.log(`${t()} connected to ${url}`);
  ws.send(JSON.stringify({ audioEncoding: 'PCM_16KHZ', mode: 'ENDPOINTING', keywords: ['room 805', 'water'], languageBias: ['English'] }));
});
ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  if (m.sessionId && !m.type) {
    console.log(`${t()} Muse session ${m.sessionId}`);
    let i = 0;
    const timer = setInterval(() => {
      // Clip, then a second of silence so the endpointer closes the turn.
      ws.send(i < pcm.length ? pcm.subarray(i, i + FRAME) : Buffer.alloc(FRAME));
      if ((i += FRAME) > pcm.length + 16000 * 2) { clearInterval(timer); ws.send(JSON.stringify({ type: 'endStream' })); }
    }, 80);
  } else if (m.type === 'speechComplete') {
    console.log(`${t()} final: "${m.transcript}"`);
  } else if (m.type === 'error') {
    console.log(`${t()} error: ${m.message}`);
  }
});
ws.on('close', (code, reason) => { console.log(`${t()} closed ${code} ${reason}`); process.exit(0); });
setTimeout(() => { console.log('timed out'); process.exit(1); }, 30000);
