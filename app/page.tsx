'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SimView, { type CameraMode, type SimCapture } from '@/components/SimView.tsx';
import RobotActions from '@/components/RobotActions.tsx';
import { useDoorFlow, kindsOf } from '@/components/useDoorFlow.ts';
import CallPanel from '@/components/CallPanel.tsx';
import RobotCard from '@/components/RobotCard.tsx';
import TaskQueue from '@/components/TaskQueue.tsx';
import BrainLog, { BrainCard } from '@/components/BrainLog.tsx';
import RoomNotifications, { type NotificationEntry } from '@/components/RoomNotifications.tsx';
import MetricsBar from '@/components/MetricsBar.tsx';
import InventoryPanel from '@/components/InventoryPanel.tsx';
import CallLogPanel, { CallFlowGraph } from '@/components/CallLogPanel.tsx';
import EscalationsPanel from '@/components/EscalationsPanel.tsx';
import { useRecords } from '@/components/useRecords.ts';
import { logCall } from '@/lib/admin/client.ts';
import { playFaultAlert } from '@/lib/alert.ts';
import { FleetClient } from '@/lib/sim/client.ts';
import { decide, type BrainEntry } from '@/lib/brain/client.ts';
import { notification } from '@/lib/fleet/notify.ts';
import { FLOOR_VERSION } from '@/lib/fleet/nav.ts';
import type { FleetSnapshot, Robot } from '@/lib/fleet/types.ts';

const SAVE_MS = 2000;

type Tab = 'live' | 'fleet' | 'deliveries' | 'calls' | 'escalations' | 'inventory' | 'brain' | 'rooms';

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
  const [tab, setTab] = useState<Tab>('live');
  const [liveCall, setLiveCall] = useState<{ id: string; room: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(true);
  const [demo, setDemo] = useState(false);
  const saved = useRef({ id: '', dirty: false, persist: true });
  const lastCall = useRef<string | null>(null); // brain requests ride on the latest call's limit
  const [visitor, setVisitor] = useState('');
  const capture = useRef<SimCapture | null>(null);

  const { records, refresh: refreshRecords } = useRecords();
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
        if (state?.snapshot?.floor !== FLOOR_VERSION) state = null; // saved on another floor plan: its robots would be outside the walls
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
            if (ev.event.type === 'battery_fault') playFaultAlert();
            if (ev.event.type === 'delivered' || ev.event.type === 'arrived' || ev.event.type === 'not_collected') {
              const { taskId } = ev.event;
              const task = snapshot.tasks.find((t) => t.id === taskId);
              const n = task && notification(ev.event, null, task);
              if (n) addNote({ id: `${taskId}-delivered`, at: Date.now(), ...n });
            }
            void decide(c!, ev, snapshot, (entry) => {
              setBrainLog((log) => [entry, ...log.filter((x) => x.id !== entry.id)]);
              if (entry.event.type === 'battery_fault') setPlan(entry);
              if (!entry.pending) {
                void logCall(lastCall.current, { tool: {
                  name: 'brain_decision',
                  args: { event: entry.event, task: entry.taskId, options: entry.options, model: entry.source === 'model' ? 'muse-wonder-1.0' : 'fallback rule' },
                  result: entry.decision,
                  summary: entry.line,
                } });
              }
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
    setLiveCall(null);
    door.reset();
    setCamera('overview');
    await client.reset();
  }

  function binLoaded(r: Robot) {
    void client?.binLoaded(r.id);
    void logCall(lastCall.current, { tool: { name: 'bin_loaded', args: { robot: r.id, task: r.taskId }, result: { sent: true }, summary: 'Staff loaded the cabin; robot on its way' } });
  }

  const r1 = snap?.robots.find((r) => r.id === 'robot_1');
  const canFault = !!r1?.taskId && !r1.fault;
  const moving = snap?.robots.filter((r) => ['to_pickup', 'to_room', 'returning'].includes(r.phase)).length ?? 0;
  const tabs: { id: Tab; label: string; count: string }[] = [
    { id: 'live', label: 'Live call', count: '–' },
    { id: 'fleet', label: 'Fleet', count: `${moving}/${snap?.robots.length ?? 2}` },
    { id: 'deliveries', label: 'Deliveries', count: String(snap?.tasks.length ?? 0) },
    { id: 'calls', label: 'Call log', count: String(records?.sessions.length ?? 0) },
    { id: 'escalations', label: 'Escalations', count: String(records?.escalations.filter((e) => e.status === 'open').length ?? 0) },
    { id: 'inventory', label: 'Inventory', count: String(records?.items.length ?? 0) },
    { id: 'brain', label: 'Brain', count: String(brainLog.length) },
    { id: 'rooms', label: 'Room notices', count: String(notes.length) },
  ];
  const show = (t: Tab) => (tab === t ? 'tab-page' : 'tab-page hidden');

  return (
    <main className="console">
      <div className="admin">
        <div className="topbar">
          <button className="menu" aria-label="Toggle menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}><span /><span /><span /></button>
          <h1>Room service ops</h1>
          <span className="spacer" />
          {error && <span className="top-error">{error}</span>}
          <span className="live-dot">Live</span>
          {demo && <span className="tag" title="Battery fault fires automatically on robot 1's first delivery">Demo mode</span>}
          <button className="btn small" disabled={!canFault} onClick={() => client?.fault('robot_1')} title="Drop robot 1's battery to 9% mid-delivery">Battery fault</button>
          <button className="btn small" onClick={reset}>Reset demo</button>
        </div>
        <div className="body">
          {menuOpen && (
            <nav className="side">
              {tabs.map((t) => (
                <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                  <span>{t.label}</span><span className="count">{t.count}</span>
                </button>
              ))}
              <p className="powered">Muse Voice Transcribe<br />Muse Spark<br />Muse Wonder<br />SAM 3.1</p>
            </nav>
          )}
          <div className="content">
            <div className={show('live')}>
              <CallPanel
                fleet={client}
                visitorId={visitor}
                onCallStart={(id, room) => { lastCall.current = id; setLiveCall({ id, room }); }}
                flow={liveCall && (
                  <div className="live-flow">
                    <CallFlowGraph
                      room={liveCall.room}
                      turns={records?.turns.filter((t) => t.session_id === liveCall.id) ?? []}
                      tools={records?.tools.filter((t) => t.session_id === liveCall.id) ?? []}
                    />
                  </div>
                )}
              >
                <RobotActions snap={snap} flow={door.flow} onLoaded={binLoaded} onCollect={door.collect} />
              </CallPanel>
            </div>
            <div className={show('fleet')}>
              <h2 className="tab-title">Fleet</h2>
              <MetricsBar snap={snap} />
              {snap?.robots.map((r) => <RobotCard key={r.id} robot={r} task={snap.tasks.find((t) => t.id === r.taskId)} now={snap.now} flow={door.flow} onLoaded={binLoaded} onCollect={door.collect} />)}
            </div>
            <div className={show('deliveries')}><h2 className="tab-title">Deliveries</h2><TaskQueue snap={snap} /></div>
            <div className={show('calls')}><h2 className="tab-title">Call log</h2><CallLogPanel records={records} /></div>
            <div className={show('escalations')}><h2 className="tab-title">Escalations</h2><EscalationsPanel records={records} callId={lastCall.current} onChange={refreshRecords} /></div>
            <div className={show('inventory')}><h2 className="tab-title">Inventory</h2><InventoryPanel records={records} /></div>
            <div className={show('brain')}><h2 className="tab-title">Brain</h2><BrainLog entries={brainLog} /></div>
            <div className={show('rooms')}><h2 className="tab-title">Room notices</h2><RoomNotifications items={notes} /></div>
          </div>
        </div>
      </div>
      <div className="stage">
        <div className="cams">
          <span className="chip dark">MuJoCo · live in your browser</span>
          {(['overview', 'robot_1', 'robot_2'] as const).map((m) => (
            <button key={m} className={`chip dark ${camera === m ? 'on' : ''}`} onClick={() => setCamera(m)}>
              {m === 'overview' ? 'Floor' : m === 'robot_1' ? 'Robot 1' : 'Robot 2'}
            </button>
          ))}
        </div>
        <SimView client={client} camera={camera} captureRef={capture} />
        {door.flash > 0 && <div key={door.flash} className="flash" />}
        {typeof camera === 'object' && <span className="povtag">{camera.pov === 'guest' ? `Guest’s view, room ${camera.room}` : `${camera.robot === 'robot_1' ? 'Robot 1' : 'Robot 2'} cabin camera`}</span>}
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
      </div>
    </main>
  );
}
