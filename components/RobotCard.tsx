import type { Robot } from '@/lib/fleet/types.ts';

const PHASE: Record<Robot['phase'], string> = {
  docked: 'Docked', to_pickup: 'To pickup', loading: 'Loading', to_room: 'Delivering',
  at_room: 'At door', returning: 'Returning', halted: 'Stopped', charging: 'Charging',
};

export default function RobotCard({ robot }: { robot: Robot }) {
  const pct = Math.round(robot.battery);
  const level = pct < 15 ? 'low' : pct < 30 ? 'mid' : 'ok';
  return (
    <div className={`robot ${robot.id}`}>
      <div className="robot-head">
        <strong>{robot.id === 'robot_1' ? 'Robot 1' : 'Robot 2'}</strong>
        <span className="phase">{PHASE[robot.phase]}{robot.taskId ? ` · ${robot.taskId}` : ''}</span>
        {robot.fault && <span className="badge red">Battery fault</span>}
      </div>
      <div className="battery" title={`${pct}%`}>
        <div className={`fill ${level}`} style={{ width: `${pct}%` }} />
        <span>{pct}%</span>
      </div>
    </div>
  );
}
