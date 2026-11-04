import type { Robot, Task } from '@/lib/fleet/types.ts';
import type { DoorFlow } from './useDoorFlow.ts';
import { RobotAction, itemsText } from './RobotActions.tsx';

const PHASE: Record<Robot['phase'], string> = {
  docked: 'Docked', to_pickup: 'To pickup', loading: 'Loading', to_room: 'Delivering',
  at_room: 'At door', returning: 'Returning', halted: 'Stopped', charging: 'Charging',
};

const STEPS: { label: string; phases: Robot['phase'][] }[] = [
  { label: 'To desk', phases: ['to_pickup'] },
  { label: 'Loading', phases: ['loading'] },
  { label: 'Delivering', phases: ['to_room', 'halted'] },
  { label: 'At door', phases: ['at_room'] },
  { label: 'Returning', phases: ['returning'] },
];

export default function RobotCard({ robot, task, now, flow, onLoaded, onCollect }: { robot: Robot; task?: Task; now: number; flow: DoorFlow | null; onLoaded: (r: Robot) => void; onCollect: () => void }) {
  const pct = Math.round(robot.battery);
  const level = pct < 15 ? 'low' : pct < 30 ? 'mid' : 'ok';
  const left = Math.max(0, Math.ceil((robot.until - now) / 1000));
  const current = STEPS.findIndex((s) => s.phases.includes(robot.phase));
  const housekeeping = robot.phase === 'at_room' && robot.taskId?.startsWith('hk');
  return (
    <section className={`panel robot ${robot.id}`}>
      <div className="robot-head">
        <strong>{robot.id === 'robot_1' ? 'Robot 1' : 'Robot 2'}</strong>
        <span className="phase">{housekeeping ? `On housekeeping, back in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : robot.phase === 'docked' ? (pct >= 100 ? 'Docked, fully charged' : 'Docked, charging') : PHASE[robot.phase]}</span>
        {robot.fault && <span className="badge red">Battery fault</span>}
        <span className="spacer" />
        <div className="battery" title={`${pct}%`}>
          <div className={`fill ${level}`} style={{ width: `${pct}%` }} />
          <span>{pct}%</span>
        </div>
      </div>
      <div className="steps-row">
        {STEPS.map((s, i) => <span key={s.label} className={i === current ? 'now' : i < current ? 'done' : ''}>{s.label}</span>)}
      </div>
      {task ? (
        <div className="robot-task">
          <small>Going to</small>
          <b>{task.room}</b>
          <span>{itemsText(task)}</span>
          <span className="mono muted">{task.id}</span>
        </div>
      ) : <div className="robot-task none">No current task</div>}
      <RobotAction robot={robot} task={task} flow={flow} onLoaded={onLoaded} onCollect={onCollect} />
    </section>
  );
}
