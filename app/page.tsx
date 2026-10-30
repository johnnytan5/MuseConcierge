'use client';

import { useEffect, useState } from 'react';
import SimView, { type CameraMode } from '@/components/SimView.tsx';
import CallPanel from '@/components/CallPanel.tsx';
import { FleetClient } from '@/lib/sim/client.ts';
import type { FleetSnapshot } from '@/lib/fleet/types.ts';

export default function Console() {
  const [client, setClient] = useState<FleetClient | null>(null);
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  const [camera, setCamera] = useState<CameraMode>('overview');
  const [error, setError] = useState('');

  useEffect(() => {
    const demo = new URLSearchParams(location.search).get('demo') === '1';
    const c = new FleetClient({ snapshot: null, demo });
    const unsubscribe = c.subscribe({
      onState: setSnap,
      onError: setError,
      // Until the brain lands, take the first offered option.
      onEvents: (events) => {
        for (const { context } of events) {
          const o = context?.options.find((x) => x.action === 'assign' || x.action === 'handoff');
          if (!o || !context) continue;
          void c.apply(o.action === 'assign'
            ? { assign: context.taskId, to: o.robot, reason: 'first option' }
            : { handoff: context.taskId, to: o.to, preempt: o.preempts, reason: 'first option' });
        }
      },
    });
    setClient(c);
    // Dev-only handle so scripted browser checks can place orders without a mic.
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __fleet: FleetClient }).__fleet = c;
    return () => { unsubscribe(); c.terminate(); };
  }, []);

  return (
    <main className="console">
      <div className="topbar">
        <h1>Muse Concierge</h1>
        <span className="muted">Meta models run the calls and the robot fleet</span>
        <span className="spacer" />
        {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
        <button className="btn small" onClick={() => client?.reset()}>Reset demo</button>
      </div>
      <div className="col">
        <CallPanel fleet={client} />
      </div>
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
      <div className="col">
        <section className="panel">
          <h2>Fleet</h2>
          {snap?.robots.map((r) => (
            <div key={r.id}>{r.id} · {r.phase} · {Math.round(r.battery)}% {r.taskId ?? ''}</div>
          ))}
          <h2>Tasks</h2>
          {snap?.tasks.map((t) => <div key={t.id}>{t.id} · {t.room} · {t.item} · {t.status} · {t.robotId ?? '-'}</div>)}
        </section>
      </div>
    </main>
  );
}
