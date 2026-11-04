// Muse Voice Transcribe adapter. Muse has no browser token, so the socket
// goes through scripts/asr-relay.mjs, which adds the API key to the handshake.
import type { AsrConnection, AsrHandlers } from './asr.ts';

const RELAY_URL = process.env.NEXT_PUBLIC_ASR_RELAY_URL ?? 'ws://localhost:8787';

export function connectMeta(keywords: string[], h: AsrHandlers): Promise<AsrConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL);
    ws.binaryType = 'arraybuffer';
    let ready = false;
    let closing = false; // we hung up; the socket closing after that is not an error

    ws.onopen = () => ws.send(JSON.stringify({
      audioEncoding: 'PCM_16KHZ',
      model: 'muse-voice-transcribe-1.0',
      mode: 'ENDPOINTING',
      emitAudioProgress: false,
      keywords,
      languageBias: ['English'],
    }));

    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (!m.type && m.sessionId) {
        ready = true;
        resolve({
          send: (frame) => { if (ws.readyState === WebSocket.OPEN) ws.send(frame); },
          close: () => {
            closing = true;
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'endStream' }));
            setTimeout(() => ws.close(), 500);
          },
        });
      } else if (m.type === 'transcript' && !m.final) {
        h.onPartial(m.transcript);
      } else if (m.type === 'speechComplete' && m.transcript?.trim()) {
        h.onFinal(m.transcript.trim());
      } else if (m.type === 'error') {
        h.onError(m.message);
      }
    };

    ws.onerror = () => { if (!ready) reject(new Error(`cannot reach ASR relay at ${RELAY_URL}`)); };
    ws.onclose = (ev) => { if (ready && !closing && ev.code !== 1000) h.onError(`transcriber closed (${ev.code} ${ev.reason})`); };
  });
}
