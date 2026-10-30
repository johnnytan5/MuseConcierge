// Runs the battery-fault demo on real MuJoCo physics in Node (no browser),
// applying the fastest feasible option for every brain question.
//   node scripts/sim-check.mts
import { readFileSync } from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { MjSim } from '../lib/sim/mjsim.ts';
import { Fleet } from '../lib/fleet/engine.ts';
import { decisionContext } from '../lib/fleet/options.ts';
import type { BrainDecision, Option } from '../lib/fleet/types.ts';

const mj = await loadMujoco();
const model = mj.MjModel.from_xml_string(readFileSync('public/sim/floor.xml', 'utf8'));
const data = new mj.MjData(model);
const sim = new MjSim(mj as never, model as never, data as never);
const clock = { now: 0 };
const fleet = new Fleet(() => clock.now, { demoFault: true });
for (const r of fleet.robots) sim.teleport(r.id, r.pose);
fleet.seedDemo();

const pick = (taskId: string, opts: Option[]): BrainDecision | null => {
  const o = opts.filter((x) => x.action !== 'wait' && (x.action !== 'continue' || x.feasible)).sort((a, b) => ('eta_s' in a ? a.eta_s : 1e9) - ('eta_s' in b ? b.eta_s : 1e9))[0];
  if (!o) return null;
  if (o.action === 'assign') return { assign: taskId, to: o.robot, reason: '' };
  if (o.action === 'handoff') return { handoff: taskId, to: o.to, preempt: o.preempts, reason: '' };
  return o.action === 'continue' ? { continue: taskId, reason: '' } : { charge_then_continue: taskId, reason: '' };
};

const DT = 1 / 60;
const log = (m: string) => console.log(`${(clock.now / 1000).toFixed(1).padStart(6)}s  ${m}`);
let t1 = '';
for (let i = 0; i < 60 * 200; i++) {
  if (i === 60 * 20) { t1 = fleet.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c' }).task_id; log(`order ${t1}`); }
  sim.step(DT);
  clock.now += DT * 1000;
  fleet.tick(DT, sim);
  for (const e of fleet.drain()) {
    const ctx = decisionContext(e, fleet.snapshot());
    const d = ctx && pick(ctx.taskId, ctx.options);
    log(`${e.type} ${'robotId' in e ? e.robotId : ''} ${d ? '→ ' + JSON.stringify(d) + ' ' + JSON.stringify(fleet.apply(d)) : ''}`);
  }
  if (t1 && fleet.tasks.find((t) => t.id === t1)?.status === 'delivered' && fleet.robots[1].phase === 'returning') break;
}
const t = fleet.tasks.find((x) => x.id === t1)!;
console.log(t.status === 'delivered' && t.robotId === 'robot_2' ? 'OK robot_2 delivered after handoff' : `FAIL ${JSON.stringify(t)}`);
for (const r of fleet.robots) console.log(r.id, r.phase, Math.round(r.battery) + '%', r.pose.x.toFixed(2), r.pose.y.toFixed(2));
// Upright check: a robot tipped by a collision has a body z axis far from vertical.
for (const r of ['robot_1', 'robot_2']) {
  const b = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, r);
  const [w, x, y] = (data.xquat as Float64Array).subarray(4 * b, 4 * b + 3);
  const tilt = Math.acos(Math.min(1, 1 - 2 * (x * x + y * y))) * 180 / Math.PI;
  console.log(r, 'tilt', tilt.toFixed(1) + '°', 'z', (data.xpos as Float64Array)[3 * b + 2].toFixed(3), w.toFixed(2));
}
