'use client';

// The guest's phone line: mic → transcriber → Muse Spark call agent → TTS.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Gate } from '@/lib/voice/gate.ts';
import { openAsr, KEYWORDS, type AsrProvider } from '@/lib/voice/asr.ts';
import { speak } from '@/lib/voice/tts.ts';
import { CallSession, type CallLog } from '@/lib/agent/session.ts';
import type { FleetApi } from '@/lib/agent/tools.ts';
import { deductStock, escalate, logCall } from '@/lib/admin/client.ts';
import { ROOMS } from '@/lib/hotel.ts';
import { callLimit } from '@/lib/call-limit.ts';

const DEFAULT_ROOM = '804';
const { enabled, perDay } = callLimit();
const PREFERRED = (process.env.NEXT_PUBLIC_ASR_PROVIDER as AsrProvider | undefined) ?? 'meta';

type Line = { who: 'guest' | 'agent' | 'system'; text: string; detail?: string };

export default function CallPanel({ fleet, visitorId, onCallStart, children, flow }: { fleet: FleetApi | null; visitorId: string; onCallStart?: (callId: string, room: string) => void; children?: ReactNode; flow?: ReactNode }) {
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [provider, setProvider] = useState<AsrProvider | null>(null);
  const hangup = useRef<() => void>(() => {});
  const add = (l: Line) => setLines((ls) => [...ls, l]);
  const transcript = useRef<HTMLOListElement>(null);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [lines, partial]);
  useEffect(() => () => hangup.current(), []); // Reset demo mid-call must not leave the mic open

  async function start() {
    if (!fleet || busy) return;
    setBusy(true);
    setLines([]);
    const gate = new Gate();
    let asr: { stop(): void } | null = null;
    let stream: MediaStream | null = null;
    let openCallId: string | null = null;
    const stop = () => {
      hangup.current = () => {}; // once only: the mic's AudioContext can't close twice
      if (openCallId) void logCall(openCallId, { end: true });
      openCallId = null;
      asr?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      setLive(false);
      setPartial('');
    };
    hangup.current = () => { stop(); add({ who: 'system', text: 'You hung up.' }); };
    try {
      const started = await (await fetch('/api/call/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, room }),
      })).json();
      if (!started.callId) throw new Error(started.error ?? 'could not start the call');
      onCallStart?.(started.callId, room);
      const callId = (openCallId = started.callId as string);
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const inv = await (await fetch('/api/inventory')).json();
      if (!inv.items) throw new Error(inv.error ?? 'inventory unavailable');
      const greeting = `Room service for room ${room}, how can I help?`;
      const call = new CallSession(started.callId, fleet, inv.items, {
        room,
        onSay: (t) => speak(t, gate, callId),
        onEnd: () => { stop(); add({ who: 'system', text: 'Call ended.' }); },
        escalate: (reason, room) => escalate(callId, reason, room),
        onLog: (e: CallLog) => {
          if (e.kind === 'guest') void logCall(callId, { turn: { role: 'guest', text: e.text } });
          if (e.kind === 'agent') void logCall(callId, { turn: { role: 'agent', text: e.text } });
          if (e.kind === 'tool') {
            const result = e.result as { error?: string; task_id?: string; item?: string; qty?: number; also?: { item: string; qty: number }[]; room?: string };
            void logCall(callId, { tool: { name: e.name, args: e.args, result, summary: result.error ?? (result.task_id ? `Task ${result.task_id} created` : 'Done') } });
            if (e.name === 'create_task' && result.task_id && result.item) {
              void deductStock(callId, result.task_id, [{ item: result.item, qty: result.qty ?? 1 }, ...(result.also ?? [])]);
              if (result.room) void logCall(callId, { room: result.room });
            }
          }
          if (e.kind === 'guest') add({ who: 'guest', text: e.text });
          else if (e.kind === 'agent') add({ who: 'agent', text: e.text, detail: `${e.ms} ms` });
          else if (e.kind === 'tool' && e.name !== 'end_call') add({ who: 'system', text: `${e.name} ${JSON.stringify(e.args)}`, detail: JSON.stringify(e.result) });
          else if (e.kind === 'error') add({ who: 'system', text: `error: ${e.text}` });
        },
      });
      const handlers = {
        stream, keywords: KEYWORDS, gate, callId: started.callId as string,
        onPartial: setPartial,
        onFinal: (t: string) => { setPartial(''); void call.onGuest(t); },
        onError: (m: string) => add({ who: 'system', text: `transcriber: ${m}` }),
      };
      let used: AsrProvider = PREFERRED;
      try {
        asr = await openAsr({ ...handlers, provider: used });
      } catch (e) {
        // Relay down or unreachable: keep the demo alive on the backup.
        if (used !== 'meta') throw e;
        used = 'assemblyai';
        add({ who: 'system', text: 'Muse relay unreachable, using AssemblyAI backup' });
        asr = await openAsr({ ...handlers, provider: used });
      }
      setProvider(used);
      setLive(true);
      add({ who: 'agent', text: greeting });
      void logCall(callId, { turn: { role: 'agent', text: greeting } });
      await speak(greeting, gate, callId);
    } catch (e) {
      stop();
      add({ who: 'system', text: `could not start: ${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="call">
      <h2 className="tab-title">Live call</h2>
      <section className="panel line">
        <header>
          <h6>Front desk line</h6>
          {provider && <span className="muted">{provider === 'meta' ? 'Muse Voice Transcribe' : 'AssemblyAI backup'} · Muse Spark</span>}
        </header>
        <div className="line-row">
          <label className="calling-from">
            <small>Calling from</small>
            <select value={room} disabled={live || busy} onChange={(e) => setRoom(e.target.value)}>
              {ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button className={live ? 'btn danger' : 'btn primary'} disabled={!fleet || busy} onClick={live ? () => hangup.current() : start}>
            {busy ? 'Connecting…' : live ? 'Hang up' : 'Call the front desk'}
          </button>
          <p className="muted">Uses your microphone. Ask for towels or an Uber Eats order.{enabled && ` Up to ${perDay} calls a day; your IP address is logged to enforce this.`}</p>
        </div>
      </section>
      {children}
      <section className="panel transcript-panel">
        <h6>Call log</h6>
        {lines.length === 0 && !partial ? (
          <div className="quiet">
            <span className="chip">Line is quiet</span>
            <h3>Waiting for a call</h3>
            <p>Nothing on the line right now. This screen fills in by itself as soon as a guest calls the front desk.</p>
          </div>
        ) : (
          <ol className="transcript" ref={transcript}>
            {lines.map((l, i) => (
              <li key={i} className={l.who}>
                <span>{l.text}</span>
                {l.detail && <small>{l.detail}</small>}
              </li>
            ))}
            {partial && <li className="guest partial"><span>{partial}</span></li>}
          </ol>
        )}
      </section>
      {flow}
    </div>
  );
}
