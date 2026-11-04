// Drives each robot to every room and back on real MuJoCo physics, measuring
// how close it gets to any wall and how squarely it parks. Fails if a robot
// scrapes a wall, gets stuck, or misses its dock.
//   node scripts/nav-check.mts
import { readFileSync } from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { MjSim } from '../lib/sim/mjsim.ts';
import { Fleet } from '../lib/fleet/engine.ts';
import { NODES } from '../lib/fleet/nav.ts';
import { dockOf } from '../lib/fleet/options.ts';
import { ROOMS } from '../lib/hotel.ts';
import { ROBOT_IDS } from '../lib/fleet/types.ts';

const MIN_WALL_CLEARANCE = 0.22; // m from the robot's centre: wheels reach 0.21
const MAX_DOCK_ERROR = 0.08; // m: the pad is 0.52 wide
const MAX_DOCK_YAW = 0.1; // rad
const MAX_TILT_DEG = 1.5; // a bounce shows up as the tall body rocking
const MAX_LIFT = 0.004; // m the base may rise off its resting height
const LIMIT_S = 120;
const DT = 1 / 60;

const mj = await loadMujoco();
const model = mj.MjModel.from_xml_string(readFileSync('public/sim/floor.xml', 'utf8'));

// Every wall as a rectangle on the floor.
const walls: { name: string; x: number; y: number; sx: number; sy: number }[] = [];
for (let i = 0; i < model.ngeom; i++) {
  const name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM.value, i) ?? '';
  if (name.startsWith('wall_')) walls.push({ name, x: model.geom_pos[3 * i], y: model.geom_pos[3 * i + 1], sx: model.geom_size[3 * i], sy: model.geom_size[3 * i + 1] });
}
const clearance = (x: number, y: number) => {
  let best = { d: Infinity, wall: '' };
  for (const w of walls) {
    const d = Math.hypot(Math.max(0, Math.abs(x - w.x) - w.sx), Math.max(0, Math.abs(y - w.y) - w.sy));
    if (d < best.d) best = { d, wall: w.name };
  }
  return best;
};

let failed = false;
for (const robot of ROBOT_IDS) {
  for (const room of ROOMS) {
    const data = new mj.MjData(model);
    const sim = new MjSim(mj as never, model as never, data as never);
    const clock = { now: 0 };
    const fleet = new Fleet(() => clock.now);
    for (const r of fleet.robots) sim.teleport(r.id, r.pose);
    const { task_id } = fleet.createTask({ item: 'towel', qty: 1, room, callId: 'c' });
    fleet.apply({ assign: task_id, to: robot, reason: '' });
    const r = fleet.robot(robot);
    let min = { d: Infinity, wall: '' };
    let tilt = 0;
    let lift = 0;
    const body = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, robot);
    const restZ = 0.06;
    let reached = false;
    let t = 0;
    for (; t < LIMIT_S; t += DT) {
      sim.step(DT);
      clock.now += DT * 1000;
      fleet.tick(DT, sim);
      fleet.drain();
      const [, qx, qy] = (data.xquat as Float64Array).subarray(4 * body, 4 * body + 4);
      if (t > 0.5) {
        tilt = Math.max(tilt, Math.acos(Math.min(1, 1 - 2 * (qx * qx + qy * qy))) * 180 / Math.PI);
        lift = Math.max(lift, (data.xpos as Float64Array)[3 * body + 2] - restZ);
      }
      const c = clearance(r.pose.x, r.pose.y);
      if (c.d < min.d) min = c;
      if (r.phase === 'at_room') reached = true;
      if (reached && r.phase === 'docked') break;
    }
    for (let s = 0; s < 300; s++) { sim.step(DT); clock.now += DT * 1000; fleet.tick(DT, sim); } // squares up on the pad
    const [dx, dy] = NODES[dockOf(robot)];
    const dockErr = Math.hypot(r.pose.x - dx, r.pose.y - dy);
    const yaw = Math.abs(Math.atan2(Math.sin(r.pose.yaw), Math.cos(r.pose.yaw)));
    const ok = reached && r.phase === 'docked' && min.d >= MIN_WALL_CLEARANCE && dockErr <= MAX_DOCK_ERROR && yaw <= MAX_DOCK_YAW && tilt <= MAX_TILT_DEG && lift <= MAX_LIFT;
    failed ||= !ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${robot} → ${room.padEnd(4)} ${t.toFixed(0).padStart(3)} s, closest wall ${min.d.toFixed(2)} m (${min.wall}), dock error ${dockErr.toFixed(3)} m, yaw ${yaw.toFixed(2)}, tilt ${tilt.toFixed(2)}°, lift ${(lift * 1000).toFixed(1)} mm, ${r.phase}`);
    data.delete?.();
  }
}
console.log(failed ? 'FAILED' : 'All routes clear');
process.exit(failed ? 1 : 0);
