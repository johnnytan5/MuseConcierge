// AssemblyAI Universal-Streaming v3 adapter, the backup transcriber. The
// browser connects directly with a short-lived token from /api/asr-token.
import type { AsrConnection, AsrHandlers } from './asr.ts';

export async function connectAssemblyAI(keywords: string[], h: AsrHandlers, callId: string): Promise<AsrConnection> {
  const res = await fetch(`/api/asr-token?callId=${encodeURIComponent(callId)}`);
  if (!res.ok) throw new Error(`asr token ${res.status}`);
  const { token } = await res.json();
  const qs = new URLSearchParams({
    sample_rate: '16000',
    encoding: 'pcm_s16le',
    format_turns: 'true',
    keyterms_prompt: JSON.stringify(keywords),
    token,
  });

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${qs}`);
    let ready = false;
    let closing = false; // we hung up; the socket closing after that is not an error

    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === 'Begin') {
        ready = true;
        resolve({
          send: (frame) => { if (ws.readyState === WebSocket.OPEN) ws.send(frame); },
          close: () => {
            closing = true;
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'Terminate' }));
            setTimeout(() => ws.close(), 500);
          },
        });
      } else if (m.type === 'Turn') {
        // An unformatted end_of_turn is followed by the formatted one; use that.
        if (m.end_of_turn && m.turn_is_formatted) { if (m.transcript.trim()) h.onFinal(m.transcript.trim()); }
        else if (!m.end_of_turn) h.onPartial(m.transcript);
      } else if (m.error) {
        h.onError(m.error);
      }
    };

    ws.onerror = () => { if (!ready) reject(new Error('cannot reach AssemblyAI')); };
    ws.onclose = (ev) => { if (ready && !closing && ev.code !== 1000) h.onError(`transcriber closed (${ev.code} ${ev.reason})`); };
  });
}
