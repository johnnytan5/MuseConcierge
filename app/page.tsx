'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SimView, { type CameraMode, type SimCapture } from '@/components/SimView.tsx';
import DoorCheckPanel, { DoorPhoto, CabinPhoto, cabinLine } from '@/components/DoorCheckPanel.tsx';
import CollectPanel from '@/components/CollectPanel.tsx';
import { useDoorFlow, kindsOf } from '@/components/useDoorFlow.ts';
import CallPanel from '@/components/CallPanel.tsx';
import RobotCard from '@/components/RobotCard.tsx';
import TaskQueue from '@/components/TaskQueue.tsx';
import BrainLog, { BrainCard } from '@/components/BrainLog.tsx';
import RoomNotifications, { type NotificationEntry } from '@/components/RoomNotifications.tsx';
import MetricsBar from '@/components/MetricsBar.tsx';
import { FleetClient } from '@/lib/sim/client.ts';
import { decide, type BrainEntry } from '@/lib/brain/client.ts';
import { notification } from '@/lib/fleet/notify.ts';
import type { FleetSnapshot } from '@/lib/fleet/types.ts';

const SAVE_MS = 2000;

// One saved run per browser; see app/api/fleet-state.
function visitorId(): string {
  try {
    let id = localStorage.getItem('muse-visitor');
    if (!id) localStorage.setItem('muse-visitor', (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export default function Console() {
  const [client, setClient] = useState<FleetClient | null>(null);
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  const [camera, setCamera] = useState<CameraMode>('overview');
  const [error, setError] = useState('');
  const [brainLog, setBrainLog] = useState<BrainEntry[]>([]);
  const [notes, setNotes] = useState<NotificationEntry[]>([]);
  const [plan, setPlan] = useState<BrainEntry | null>(null);
  const [demo, setDemo] = useState(false);
  const saved = useRef({ id: '', dirty: false, persist: true });
  const lastCall = useRef<string | null>(null); // brain requests ride on the latest call's limit
  const [visitor, setVisitor] = useState('');
  const capture = useRef<SimCapture | null>(null);

  const addNote = useCallback((n: NotificationEntry) => setNotes((ns) => [n, ...ns.filter((x) => x.id !== n.id)]), []);
  const door = useDoorFlow({ capture, client, callId: lastCall, setCamera, addNote });
  const onFlowState = useRef(door.onState);
  onFlowState.current = door.onState;

  // Items ride in a robot's cabin from the pickup until the guest takes them.
  const cabinKeys = useRef<Record<string, string>>({});
  const loadCabins = useCallback((s: FleetSnapshot) => {
    for (const r of s.robots) {
      const t = s.tasks.find((x) => x.id === r.taskId);
      const carrying = t?.kind === 'guest' && ['loading', 'to_room', 'at_room', 'halted'].includes(r.phase) && !['delivered', 'cancelled'].includes(t.status);
      const kinds = t && carrying ? kindsOf(t) : [];
      const key = kinds.join();
      if (cabinKeys.current[r.id] !== key && capture.current) {
        capture.current.setItems(r.id, kinds);
        cabinKeys.current[r.id] = key;
      }
    }
  }, []);

  useEffect(() => {
    let c: FleetClient | null = null;
    let unsubscribe = () => {};
    let cancelled = false;
    const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === '1' || new URLSearchParams(location.search).get('demo') === '1';
    setDemo(isDemo);
    const id = (saved.current.id = visitorId());
    setVisitor(id);

    (async () => {
      let state: { snapshot: FleetSnapshot | null; brain_log: BrainEntry[]; notifications: NotificationEntry[] } | null = null;
      try {
        const res = await fetch(`/api/fleet-state?id=${id}`);
        if (res.ok) state = (await res.json()).state;
        else saved.current.persist = false; // table not set up: run without saving
      } catch {
        saved.current.persist = false;
      }
      if (cancelled) return;
      if (state) {
        setBrainLog(state.brain_log ?? []);
        setNotes(state.notifications ?? []);
      }
      c = new FleetClient({ snapshot: state?.snapshot ?? null, demo: isDemo });
      unsubscribe = c.subscribe({
        onState: (s) => { setSnap(s); saved.current.dirty = true; onFlowState.current(s); loadCabins(s); },
        onError: setError,
        onEvents: (events, snapshot) => {
          for (const ev of events) {
            if (ev.event.type === 'delivered' || ev.event.type === 'arrived' || ev.event.type === 'not_collected') {
              const { taskId } = ev.event;
              const task = snapshot.tasks.find((t) => t.id === taskId);
              const n = task && notification(ev.event, null, task);
              if (n) addNote({ id: `${taskId}-delivered`, at: Date.now(), ...n });
            }
            void decide(c!, ev, snapshot, (entry) => {
              setBrainLog((log) => [entry, ...log.filter((x) => x.id !== entry.id)]);
              if (entry.event.type === 'battery_fault') setPlan(entry);
              if (entry.notify) addNote({ id: `brain-${entry.id}`, at: Date.now(), ...entry.notify });
            }, lastCall.current);
          }
        },
      });
      setClient(c);
      // Dev-only handle so scripted browser checks can place orders without a mic.
      if (process.env.NODE_ENV !== 'production') Object.assign(window, { __fleet: c, __capture: capture });
    })();

    return () => { cancelled = true; unsubscribe(); c?.terminate(); };
  }, [addNote, loadCabins]);

  // Save the run every couple of seconds while it changes.
  const latest = useRef({ snap, brainLog, notes });
  latest.current = { snap, brainLog, notes };
  useEffect(() => {
    const t = setInterval(() => {
      const s = saved.current;
      if (!s.persist || !s.dirty || !latest.current.snap) return;
      s.dirty = false;
      const { snap: snapshot, brainLog: brain_log, notes: notifications } = latest.current;
      void fetch('/api/fleet-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, snapshot, brain_log: brain_log.filter((b) => !b.pending).slice(0, 50), notifications: notifications.slice(0, 50) }),
      }).then((r) => { if (!r.ok) s.persist = false; });
    }, SAVE_MS);
    return () => clearInterval(t);
  }, []);

  async function reset() {
    if (!client) return;
    setBrainLog([]);
    setNotes([]);
    setPlan(null);
    door.reset();
    setCamera('overview');
    await client.reset();
  }

  const r1 = snap?.robots.find((r) => r.id === 'robot_1');
  const canFault = !!r1?.taskId && !r1.fault;

  return (
    <main className="console">
      <div className="topbar">
        <h1>Muse Concierge</h1>
        <span className="muted">Muse Voice Transcribe · Muse Spark call agent · Muse Wonder fleet brain</span>
        <span className="spacer" />
        {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
        <MetricsBar snap={snap} />
        <button className="btn small" disabled={!canFault} onClick={() => client?.fault('robot_1')} title="Drop robot 1's battery to 9% mid-delivery">
          Battery fault: robot 1
        </button>
        <button className="btn small" onClick={reset}>Reset demo</button>
        {demo && <span className="badge red" title="Battery fault fires automatically on robot 1's first delivery">demo mode</span>}
      </div>
      <div className="col">
        <CallPanel fleet={client} visitorId={visitor} onCallStart={(id) => { lastCall.current = id; }} />
        <CollectPanel flow={door.flow} onCollect={door.collect} />
      </div>
      <div className="center">
        <div className="stage">
          <div className="cams">
            {(['overview', 'robot_1', 'robot_2'] as const).map((m) => (
              <button key={m} className={`btn small ${camera === m ? 'on' : ''}`} onClick={() => setCamera(m)}>
                {m === 'overview' ? 'Floor' : m === 'robot_1' ? 'Robot 1' : 'Robot 2'}
              </button>
            ))}
          </div>
          <SimView client={client} camera={camera} captureRef={capture} />
          {door.flash > 0 && <div key={door.flash} className="flash" />}
          {typeof camera === 'object' && <span className="povtag">{camera.robot === 'robot_1' ? 'Robot 1' : 'Robot 2'} {camera.pov === 'door' ? 'door camera' : 'cabin camera'}</span>}
          {door.tip && (
            <div className="tip" key={door.tip.id} role="status">
              <span>{door.tip.text}</span>
              <button className="close" aria-label="Dismiss" onClick={door.dismissTip}>×</button>
            </div>
          )}
          {plan && (
            <div className="plan">
              <header>
                <span>Battery fault: the brain re-plans</span>
                <button className="close" aria-label="Dismiss" onClick={() => setPlan(null)}>×</button>
              </header>
              <BrainCard b={plan} />
            </div>
          )}
          {door.resultOpen && door.flow && (door.flow.after ?? door.flow.before ?? door.flow.door) && (
            <div className="result">
              <header>
                <span>{door.flow.after ? 'SAM 3.1: cabin after collection' : door.flow.before ? 'SAM 3.1: cabin on arrival' : 'SAM 3.1: door check'}</span>
                <button className="close" aria-label="Dismiss" onClick={door.closeResult}>×</button>
              </header>
              {door.flow.after ? <CabinPhoto shot={door.flow.after} /> : door.flow.before ? <CabinPhoto shot={door.flow.before} /> : <DoorPhoto shot={door.flow.door!} />}
              <small className="muted">{door.flow.after ? cabinLine(door.flow.after.result) : door.flow.before ? cabinLine(door.flow.before.result) : door.flow.door?.result ? `Plate reads ${door.flow.door.result.number ?? '?'}` : 'Checking…'}</small>
            </div>
          )}
        </div>
        <div className="below">
          <TaskQueue snap={snap} />
          <BrainLog entries={brainLog} />
        </div>
      </div>
      <div className="col">
        <section className="panel">
          <h2>Fleet</h2>
          {snap?.robots.map((r) => <RobotCard key={r.id} robot={r} />)}
        </section>
        <DoorCheckPanel flow={door.flow} />
        <RoomNotifications items={notes} />
      </div>
    </main>
  );
}
