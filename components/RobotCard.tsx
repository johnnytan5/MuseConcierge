import type { Robot } from '@/lib/fleet/types.ts';

const PHASE: Record<Robot['phase'], string> = {
  docked: 'Docked', to_pickup: 'To pickup', loading: 'Loading', to_room: 'Delivering',
  at_room: 'At door', returning: 'Returning', halted: 'Stopped', charging: 'Charging',
};

export default function RobotCard({ robot, now }: { robot: Robot; now: number }) {
  const left = Math.max(0, Math.ceil((robot.until - now) / 1000));
  const pct = Math.round(robot.battery);
  const level = pct < 15 ? 'low' : pct < 30 ? 'mid' : 'ok';
  return (
    <div className={`robot ${robot.id}`}>
      <div className="robot-head">
        <strong>{robot.id === 'robot_1' ? 'Robot 1' : 'Robot 2'}</strong>
        {/* A housekeeping drop parks the robot for minutes: it isn't stuck. */}
        <span className="phase">{robot.phase === 'at_room' && robot.taskId?.startsWith('hk') ? `On housekeeping, back in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : PHASE[robot.phase]}{robot.taskId ? ` · ${robot.taskId}` : ''}</span>
        {robot.fault && <span className="badge red">Battery fault</span>}
      </div>
      <div className="battery" title={`${pct}%`}>
        <div className={`fill ${level}`} style={{ width: `${pct}%` }} />
        <span>{pct}%</span>
      </div>
    </div>
  );
}
