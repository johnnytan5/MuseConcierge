'use client';

import { useEffect, useRef, useState } from 'react';
import SimView, { type CameraMode } from '@/components/SimView.tsx';
import CallPanel from '@/components/CallPanel.tsx';
import RobotCard from '@/components/RobotCard.tsx';
import TaskQueue from '@/components/TaskQueue.tsx';
import BrainLog from '@/components/BrainLog.tsx';
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
  const [demo, setDemo] = useState(false);
  const saved = useRef({ id: '', dirty: false, persist: true });

  useEffect(() => {
    let c: FleetClient | null = null;
    let unsubscribe = () => {};
    let cancelled = false;
    const isDemo = new URLSearchParams(location.search).get('demo') === '1';
    setDemo(isDemo);
    const id = (saved.current.id = visitorId());

    const addNote = (n: NotificationEntry) => setNotes((ns) => [n, ...ns.filter((x) => x.id !== n.id)]);

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
        onState: (s) => { setSnap(s); saved.current.dirty = true; },
        onError: setError,
        onEvents: (events, snapshot) => {
          for (const ev of events) {
            if (ev.event.type === 'delivered') {
              const { taskId } = ev.event;
              const task = snapshot.tasks.find((t) => t.id === taskId);
              const n = task && notification(ev.event, null, task);
              if (n) addNote({ id: `${taskId}-arrived`, at: Date.now(), ...n });
            }
            void decide(c!, ev, snapshot, (entry) => {
              setBrainLog((log) => [entry, ...log.filter((x) => x.id !== entry.id)]);
              if (entry.notify) addNote({ id: `brain-${entry.id}`, at: Date.now(), ...entry.notify });
            });
          }
        },
      });
      setClient(c);
      // Dev-only handle so scripted browser checks can place orders without a mic.
      if (process.env.NODE_ENV !== 'production') (window as unknown as { __fleet: FleetClient }).__fleet = c;
    })();

    return () => { cancelled = true; unsubscribe(); c?.terminate(); };
  }, []);

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
        <CallPanel fleet={client} />
      </div>
      <div className="center">
        <div className="stage">
          <div className="cams">
            {(['overview', 'robot_1', 'robot_2'] as CameraMode[]).map((m) => (
              <button key={m} className={`btn small ${camera === m ? 'on' : ''}`} onClick={() => setCamera(m)}>
                {m === 'overview' ? 'Floor' : m === 'robot_1' ? 'Robot 1' : 'Robot 2'}
              </button>
            ))}
          </div>
          <SimView client={client} camera={camera} />
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
        <RoomNotifications items={notes} />
      </div>
    </main>
  );
}
