'use client';

// Bench page for the voice loop. Removed once the live console exists.
import { useRef, useState } from 'react';
import { Gate } from '@/lib/voice/gate.ts';
import { openAsr, KEYWORDS, type AsrProvider } from '@/lib/voice/asr.ts';
import { speak } from '@/lib/voice/tts.ts';
import { CallSession } from '@/lib/agent/session.ts';
import type { FleetApi } from '@/lib/agent/tools.ts';

export default function VoiceTest() {
  const [provider, setProvider] = useState<AsrProvider>('meta');
  const [partial, setPartial] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [agentOn, setAgentOn] = useState(true);
  const gate = useRef(new Gate());
  const session = useRef<{ stop(): void } | null>(null);
  const add = (line: string) => { if (line) setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l]); };

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      let call: CallSession | null = null;
      if (agentOn) {
        const { items } = await (await fetch('/api/inventory')).json();
        // Stub fleet until the engine exists: logs the task and quotes a fixed ETA.
        const fleet: FleetApi = {
          createTask: (i) => { add(`fleet: task ${JSON.stringify(i)}`); return { task_id: 't1', eta_seconds: 130 }; },
          getTask: () => null,
          cancelTask: () => false,
        };
        call = new CallSession(`call_${Date.now()}`, fleet, items, {
          onSay: (t) => speak(t, gate.current),
          onEnd: () => { add('call ended by agent'); stop(); },
          onLog: (e) => add(e.kind === 'agent' ? `agent (${e.ms} ms): ${e.text}`
            : e.kind === 'tool' ? `tool ${e.name} ${JSON.stringify(e.args)} → ${JSON.stringify(e.result)}`
            : e.kind === 'error' ? `error: ${e.text}` : ''),
        });
      }
      session.current = await openAsr({
        provider, stream, keywords: KEYWORDS, gate: gate.current,
        onPartial: setPartial,
        onFinal: (t) => { setPartial(''); add(`final: ${t}`); void call?.onGuest(t); },
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
      <label style={{ marginRight: 12 }}>
        <input type="checkbox" checked={agentOn} disabled={live} onChange={(e) => setAgentOn(e.target.checked)} /> Muse Spark agent
      </label>
      <button style={btn} onClick={live ? stop : start}>{live ? 'Stop' : 'Start mic'}</button>
      <button style={btn} onClick={() => speak('Two towels to room eight oh four, about two minutes.', gate.current).then(() => add('spoke'))}>
        Speak test line
      </button>
      <p style={{ minHeight: 24, opacity: 0.6 }}>{partial}</p>
      <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
    </main>
  );
}
