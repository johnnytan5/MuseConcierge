'use client';

// Bench page for the voice loop. Removed once the live console exists.
import { useRef, useState } from 'react';
import { Gate } from '@/lib/voice/gate.ts';
import { openAsr, KEYWORDS, type AsrProvider } from '@/lib/voice/asr.ts';
import { speak } from '@/lib/voice/tts.ts';

export default function VoiceTest() {
  const [provider, setProvider] = useState<AsrProvider>('meta');
  const [partial, setPartial] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const gate = useRef(new Gate());
  const session = useRef<{ stop(): void } | null>(null);
  const add = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      session.current = await openAsr({
        provider, stream, keywords: KEYWORDS, gate: gate.current,
        onPartial: setPartial,
        onFinal: (t) => { setPartial(''); add(`final: ${t}`); },
        onError: (m) => add(`error: ${m}`),
      });
      setLive(true);
      add(`listening via ${provider}`);
    } catch (e) {
      add(`start failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  function stop() {
    session.current?.stop();
    session.current = null;
    setLive(false);
    add('stopped');
  }

  const btn = { padding: '8px 14px', marginRight: 8 } as const;
  return (
    <main style={{ padding: 24, maxWidth: 760 }}>
      <h1 style={{ fontSize: 20 }}>Voice loop bench</h1>
      <select value={provider} disabled={live} onChange={(e) => setProvider(e.target.value as AsrProvider)} style={btn}>
        <option value="meta">Muse Voice Transcribe</option>
        <option value="assemblyai">AssemblyAI (backup)</option>
      </select>
      <button style={btn} onClick={live ? stop : start}>{live ? 'Stop' : 'Start mic'}</button>
      <button style={btn} onClick={() => speak('Two towels to room eight oh four, about two minutes.', gate.current).then(() => add('spoke'))}>
        Speak test line
      </button>
      <p style={{ minHeight: 24, opacity: 0.6 }}>{partial}</p>
      <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
    </main>
  );
}
