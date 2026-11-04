'use client';

// What the robot's cameras saw at the door, with SAM 3.1's boxes on each photo.
import { ITEM_LABEL, cabinVerdict, type Box, type CabinCheck, type DoorCheck, type ItemKind, type Verdict } from '@/lib/vision/doorcheck.ts';
import type { DoorFlow } from './useDoorFlow.ts';

const VERDICT: Record<Verdict, string> = { confirmed: 'Right door', wrong_door: 'Wrong door', unsure: 'Could not confirm' };

function Photo({ image, alt, boxes }: { image: string; alt: string; boxes: { box: Box; label: string; cls: string }[] }) {
  const pct = (v: number, of: number) => `${(100 * v) / of}%`;
  return (
    <div className="doorshot">
      <img src={image} alt={alt} />
      {boxes.map(({ box, label, cls }) => (
        <div key={label} className={`samBox ${cls}`} style={{ left: pct(box.x1, box.w), top: pct(box.y1, box.h), width: pct(box.x2 - box.x1, box.w), height: pct(box.y2 - box.y1, box.h) }}>
          <span>{label} {box.c.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

export function DoorPhoto({ shot }: { shot: { image: string; result?: DoorCheck } }) {
  const r = shot.result;
  const boxes = [
    ...(r?.door ? [{ box: r.door, label: 'door', cls: 'door' }] : []),
    ...(r?.sign ? [{ box: r.sign, label: 'room sign', cls: 'sign' }] : []),
  ];
  return <Photo image={shot.image} alt="Robot camera at the room door" boxes={boxes} />;
}

export function CabinPhoto({ shot }: { shot: { image: string; result?: CabinCheck } }) {
  const boxes = Object.entries(shot.result?.found ?? {}).flatMap(([k, box], i) => (box ? [{ box, label: ITEM_LABEL[k as ItemKind], cls: i ? 'sign' : 'door' }] : []));
  return <Photo image={shot.image} alt="Cabin camera" boxes={boxes} />;
}

export function cabinLine(r: CabinCheck | undefined): string {
  if (!r) return 'SAM 3.1 is looking…';
  const v = cabinVerdict(r);
  if (v === 'empty') return `Cabin empty · ${(r.ms / 1000).toFixed(1)} s`;
  if (v === 'unknown') return 'Could not check the cabin';
  const parts = Object.entries(r.found).map(([k, b]) => `${ITEM_LABEL[k as ItemKind]} ${b ? b.c.toFixed(2) : 'not seen'}`);
  return `${parts.join(' · ')} · ${(r.ms / 1000).toFixed(1)} s`;
}

export default function DoorCheckPanel({ flow }: { flow: DoorFlow | null }) {
  return (
    <section className="panel">
      <header>
        <h2>Robot cameras</h2>
        <span className="muted">SAM 3.1 · Muse Spark</span>
      </header>
      {!flow && <p className="muted">The robot photographs the door and its cabin when it arrives</p>}
      {flow?.door && (
        <>
          <DoorPhoto shot={flow.door} />
          <div className="doorfacts">
            <span><span className="room">{flow.room}</span> {flow.robotId === 'robot_1' ? 'Robot 1' : 'Robot 2'}</span>
            {flow.door.result ? (
              <>
                <span>Plate reads <strong>{flow.door.result.number ?? '?'}</strong></span>
                <span className={`verdict ${flow.door.verdict}`}>{VERDICT[flow.door.verdict!]}</span>
                <small className="muted">{(flow.door.result.ms / 1000).toFixed(1)} s</small>
              </>
            ) : <span className="muted">Checking…</span>}
          </div>
        </>
      )}
      {flow?.before && (
        <>
          <h3>Cabin on arrival</h3>
          <CabinPhoto shot={flow.before} />
          <small className="muted">{cabinLine(flow.before.result)}</small>
        </>
      )}
      {flow?.after && (
        <>
          <h3>Cabin after collection</h3>
          <CabinPhoto shot={flow.after} />
          <small className="muted">{cabinLine(flow.after.result)}</small>
        </>
      )}
      {flow?.error && <small className="muted">Check failed: {flow.error}</small>}
    </section>
  );
}
