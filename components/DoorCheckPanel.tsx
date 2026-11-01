'use client';

// What the robot's door camera saw on arrival, with SAM 3.1's boxes on it and
// the number Muse Spark read off the plate.
import type { Box, DoorCheck, Verdict } from '@/lib/vision/doorcheck.ts';
import type { RobotId } from '@/lib/fleet/types.ts';

export type DoorCheckEntry = { taskId: string; room: string; robotId: RobotId; image: string; result?: DoorCheck; verdict?: Verdict; error?: string };

const VERDICT: Record<Verdict, string> = {
  confirmed: 'Right door',
  wrong_door: 'Wrong door',
  unsure: 'Could not confirm',
};

function Overlay({ box, label, cls }: { box: Box | null | undefined; label: string; cls: string }) {
  if (!box) return null;
  const pct = (v: number, of: number) => `${(100 * v) / of}%`;
  return (
    <div className={`samBox ${cls}`} style={{ left: pct(box.x1, box.w), top: pct(box.y1, box.h), width: pct(box.x2 - box.x1, box.w), height: pct(box.y2 - box.y1, box.h) }}>
      <span>{label} {box.c.toFixed(2)}</span>
    </div>
  );
}

export default function DoorCheckPanel({ entry }: { entry: DoorCheckEntry | null }) {
  const r = entry?.result;
  return (
    <section className="panel">
      <header>
        <h2>Door check</h2>
        <span className="muted">SAM 3.1 · Muse Spark</span>
      </header>
      {!entry && <p className="muted">The robot photographs the door when it arrives</p>}
      {entry && (
        <>
          <div className="doorshot">
            <img src={entry.image} alt={`Robot camera at room ${entry.room}`} />
            <Overlay box={r?.door} label="door" cls="door" />
            <Overlay box={r?.sign} label="room sign" cls="sign" />
          </div>
          <div className="doorfacts">
            <span><span className="room">{entry.room}</span> {entry.robotId === 'robot_1' ? 'Robot 1' : 'Robot 2'}</span>
            {!r && !entry.error && <span className="muted">Checking…</span>}
            {entry.error && <span className="muted">Check failed: {entry.error}</span>}
            {r && (
              <>
                <span>Plate reads <strong>{r.number ?? '?'}</strong></span>
                <span className={`verdict ${entry.verdict}`}>{VERDICT[entry.verdict!]}</span>
                <small className="muted">{(r.ms / 1000).toFixed(1)} s</small>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
