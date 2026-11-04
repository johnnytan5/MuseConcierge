'use client';

// What a person does for a robot, on the spot: load it at the desk, take the
// items at the door. The check photos belong here, with the step they prove,
// and show only the cabin and the room's number plate.
import { ITEM_LABEL, cabinVerdict, type Box, type CabinCheck, type DoorCheck, type ItemKind, type Verdict } from '@/lib/vision/doorcheck.ts';
import { lineItems, type FleetSnapshot, type Robot, type Task } from '@/lib/fleet/types.ts';
import type { DoorFlow } from './useDoorFlow.ts';

const VERDICT: Record<Verdict, string> = { confirmed: 'Right door', wrong_door: 'Wrong door', unsure: 'Could not confirm' };

const STATUS: Record<DoorFlow['step'], string> = {
  door_photo: 'Arriving, checking the room number…',
  cabin_photo: 'Checking the cabin…',
  waiting: 'Waiting for the guest to collect',
  collecting: 'Guest is taking the items…',
  checking: 'Checking the cabin is empty…',
  collected: 'Collected. Robot is closing up.',
  still_there: 'Something is still in the cabin',
  unknown: 'Could not check the cabin. Try again.',
  timed_out: 'Nobody collected. Robot went home.',
};

export const itemsText = (t: Pick<Task, 'item' | 'qty' | 'also'>) => lineItems(t).map((l) => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.item}`).join(' + ');

function Photo({ image, title, line, boxes }: { image: string; title: string; line: React.ReactNode; boxes: { box: Box; label: string; cls: string }[] }) {
  const pct = (v: number, of: number) => `${(100 * v) / of}%`;
  return (
    <figure>
      <figcaption>{title}</figcaption>
      <div className="doorshot">
        <img src={image} alt={title} />
        {boxes.map(({ box, label, cls }) => (
          <div key={label} className={`samBox ${cls}`} style={{ left: pct(box.x1, box.w), top: pct(box.y1, box.h), width: pct(box.x2 - box.x1, box.w), height: pct(box.y2 - box.y1, box.h) }}>
            <span>{label} {box.c.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <small className="muted">{line}</small>
    </figure>
  );
}

function cabinLine(r: CabinCheck | undefined): string {
  if (!r) return 'SAM 3.1 is looking…';
  const v = cabinVerdict(r);
  if (v === 'empty') return `Cabin empty · ${(r.ms / 1000).toFixed(1)} s`;
  if (v === 'unknown') return 'Could not check the cabin';
  return `${Object.entries(r.found).map(([k, b]) => `${ITEM_LABEL[k as ItemKind]} ${b ? b.c.toFixed(2) : 'not seen'}`).join(' · ')} · ${(r.ms / 1000).toFixed(1)} s`;
}

const cabinBoxes = (r: CabinCheck | undefined) =>
  Object.entries(r?.found ?? {}).flatMap(([k, box], i) => (box ? [{ box, label: ITEM_LABEL[k as ItemKind], cls: i ? 'sign' : 'door' }] : []));

function doorBoxes(r: DoorCheck | undefined) {
  return [...(r?.door ? [{ box: r.door, label: 'door', cls: 'door' }] : []), ...(r?.sign ? [{ box: r.sign, label: 'room sign', cls: 'sign' }] : [])];
}

function Checks({ flow }: { flow: DoorFlow }) {
  if (!flow.door && !flow.before && !flow.after) return null;
  return (
    <div className="checks">
      {flow.door && (
        <Photo image={flow.door.image} title={`Room ${flow.room} number`} boxes={doorBoxes(flow.door.result)} line={
          flow.door.result
            ? <>Plate reads <b>{flow.door.result.number ?? '?'}</b> · <span className={`verdict ${flow.door.verdict}`}>{VERDICT[flow.door.verdict!]}</span></>
            : 'SAM 3.1 and Muse Spark are looking…'
        } />
      )}
      {flow.before && <Photo image={flow.before.image} title="Cabin on arrival" boxes={cabinBoxes(flow.before.result)} line={cabinLine(flow.before.result)} />}
      {flow.after && <Photo image={flow.after.image} title="Cabin after collection" boxes={cabinBoxes(flow.after.result)} line={cabinLine(flow.after.result)} />}
    </div>
  );
}

// The action and photos for one robot, or nothing if it needs nobody.
export function RobotAction({ robot, task, flow, onLoaded, onCollect }: { robot: Robot; task?: Task; flow: DoorFlow | null; onLoaded: (r: Robot) => void; onCollect: () => void }) {
  const here = flow?.robotId === robot.id && flow.taskId === robot.taskId ? flow : null;
  const loading = robot.phase === 'loading' && task?.kind === 'guest';
  const ready = !!here && ['waiting', 'still_there', 'unknown'].includes(here.step);
  if (!loading && !here) return null;
  return (
    <div className="action-box">
      {loading ? (
        <>
          <button className="btn primary" onClick={() => onLoaded(robot)}>Bin loaded — send it</button>
          <small className="muted">At the front desk: {itemsText(task!)}</small>
        </>
      ) : (
        <>
          <button className="btn primary" disabled={!ready} onClick={onCollect}>
            {here!.step === 'still_there' || here!.step === 'unknown' ? 'Check the cabin again' : 'Mimic collection'}
          </button>
          <small className="muted">
            {STATUS[here!.step]}
            {here!.step === 'waiting' && here!.kinds.length > 0 && `: ${here!.kinds.map((k) => ITEM_LABEL[k]).join(' + ')}`}
          </small>
          <Checks flow={here!} />
          {here!.error && <small className="muted">Check failed: {here!.error}</small>}
        </>
      )}
    </div>
  );
}

// Live call: whichever robots need someone right now.
export default function RobotActions({ snap, flow, onLoaded, onCollect }: { snap: FleetSnapshot | null; flow: DoorFlow | null; onLoaded: (r: Robot) => void; onCollect: () => void }) {
  const robots = snap?.robots ?? [];
  const actions = robots.map((r) => ({ r, task: snap?.tasks.find((t) => t.id === r.taskId) }))
    .filter(({ r, task }) => (r.phase === 'loading' && task?.kind === 'guest') || (flow?.robotId === r.id && flow.taskId === r.taskId));
  const atDoor = flow && actions.some(({ r }) => r.id === flow.robotId && r.taskId === flow.taskId);
  return (
    <section className="panel robot-actions">
      <h6>At the robot</h6>
      {actions.map(({ r, task }) => (
        <div key={r.id}>
          <strong className={r.id}>{r.id === 'robot_1' ? 'Robot 1' : 'Robot 2'}</strong>
          <RobotAction robot={r} task={task} flow={flow} onLoaded={onLoaded} onCollect={onCollect} />
        </div>
      ))}
      {!actions.length && !flow && <small className="muted">Actions appear here when a robot is at the desk or a guest’s door</small>}
      {flow && !atDoor && (
        <div>
          <small className="muted">Last delivery, room {flow.room}: {flow.step === 'timed_out' ? 'not collected' : 'collected'}</small>
          <Checks flow={flow} />
        </div>
      )}
    </section>
  );
}
