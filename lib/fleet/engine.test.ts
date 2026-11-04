import test from 'node:test';
import assert from 'node:assert/strict';
import { Fleet } from './engine.ts';
import { NODES } from './nav.ts';
import { optionsFor } from './options.ts';
import type { FleetEvent, Pose, RobotId, SimPort } from './types.ts';

// Kinematic stand-in for MuJoCo: integrates (v, w) exactly.
class FakeSim implements SimPort {
  poses = new Map<RobotId, Pose>();
  vel = new Map<RobotId, [number, number]>();
  lids = new Map<RobotId, boolean>();
  pose(r: RobotId) { return { ...this.poses.get(r)! }; }
  drive(r: RobotId, v: number, w: number) { this.vel.set(r, [v, w]); }
  lid(r: RobotId, open: boolean) { this.lids.set(r, open); }
  teleport(r: RobotId, p: Pose) { this.poses.set(r, { ...p }); }
  step(dt: number) {
    for (const [r, p] of this.poses) {
      const [v, w] = this.vel.get(r) ?? [0, 0];
      this.poses.set(r, { x: p.x + v * Math.cos(p.yaw) * dt, y: p.y + v * Math.sin(p.yaw) * dt, yaw: p.yaw + w * dt });
    }
  }
}

function setup(opts: { demoFault?: boolean } = {}) {
  const clock = { now: 1_000_000 };
  const fleet = new Fleet(() => clock.now, opts);
  const sim = new FakeSim();
  for (const r of fleet.robots) sim.teleport(r.id, r.pose);
  const events: FleetEvent[] = [];
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 0.05) {
      sim.step(0.05);
      clock.now += 50;
      fleet.tick(0.05, sim);
      events.push(...fleet.drain());
      if (until?.()) return;
    }
  };
  return { fleet, sim, clock, events, run };
}

const robot = (f: Fleet, id: RobotId) => f.robots.find((r) => r.id === id)!;
const task = (f: Fleet, id: string) => f.tasks.find((t) => t.id === id)!;

test('createTask queues, emits task_created and returns an ETA at once', () => {
  const { fleet } = setup();
  const r = fleet.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c1' });
  assert.equal(task(fleet, r.task_id).status, 'queued');
  assert.ok(r.eta_seconds > 10 && r.eta_seconds < 120);
  assert.deepEqual(fleet.drain(), [{ type: 'task_created', taskId: r.task_id }]);
});

test('assign runs docked→to_pickup→loading→to_room→at_room→returning→docked, emits delivered then robot_idle', () => {
  const { fleet, sim, events, run } = setup();
  const { task_id } = fleet.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c1' });
  assert.deepEqual(fleet.apply({ assign: task_id, to: 'robot_1', reason: 'idle' }), { ok: true });
  const phases: string[] = [];
  let lidOpened = false;
  run(200, () => {
    const p = robot(fleet, 'robot_1').phase;
    if (phases.at(-1) !== p) phases.push(p);
    lidOpened ||= sim.lids.get('robot_1') === true;
    return p === 'docked' && phases.length > 1;
  });
  assert.deepEqual(phases, ['to_pickup', 'loading', 'to_room', 'at_room', 'returning', 'docked']);
  assert.ok(lidOpened);
  assert.equal(task(fleet, task_id).status, 'delivered');
  const kinds = events.map((e) => e.type);
  assert.ok(kinds.indexOf('delivered') < kinds.lastIndexOf('robot_idle'));
  assert.ok(robot(fleet, 'robot_1').battery < 64, 'driving drains the battery');
});

test('apply rejects decisions that are not among the options', () => {
  const { fleet } = setup();
  fleet.seedDemo(); // robot_2 busy on hk1
  const { task_id } = fleet.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c1' });
  assert.equal(fleet.apply({ assign: task_id, to: 'robot_2', reason: 'x' }).ok, false);
  assert.equal(fleet.apply({ assign: 'nope', to: 'robot_1', reason: 'x' }).ok, false);
  assert.equal(fleet.apply({ continue: task_id, reason: 'x' }).ok, false);
  assert.equal(task(fleet, task_id).status, 'queued');
});

test('demo: battery fault at fault_point → handoff → robot_2 delivers, hk1 back in queue then reassigned', () => {
  const { fleet, events, run } = setup({ demoFault: true });
  fleet.seedDemo();
  run(5);
  const { task_id } = fleet.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c1' });
  assert.ok(fleet.apply({ assign: task_id, to: 'robot_1', reason: 'robot 2 busy' }).ok);

  run(120, () => events.some((e) => e.type === 'battery_fault'));
  const fault = events.find((e) => e.type === 'battery_fault');
  assert.deepEqual(fault, { type: 'battery_fault', robotId: 'robot_1', taskId: task_id, battery: 9 });
  assert.equal(robot(fleet, 'robot_1').phase, 'halted');
  const r1 = robot(fleet, 'robot_1').pose;
  // 804 is before the corridor's fault point, so it fires a metre short of the door.
  assert.ok(Math.hypot(r1.x - (NODES.door_804[0] - 1), r1.y) < 0.6);

  const handoff = optionsFor(task_id, fleet.snapshot()).find((o) => o.action === 'handoff');
  assert.ok(handoff && handoff.action === 'handoff');
  assert.ok(fleet.apply({ handoff: task_id, to: 'robot_2', preempt: handoff.preempts, reason: 'faster' }).ok);
  assert.equal(task(fleet, task_id).status, 'reassigned');
  assert.equal(task(fleet, task_id).robotId, 'robot_2');
  assert.equal(task(fleet, 'hk1').status, 'queued');
  assert.equal(task(fleet, 'hk1').robotId, null);
  assert.equal(robot(fleet, 'robot_1').phase, 'returning');

  run(200, () => task(fleet, task_id).status === 'delivered');
  assert.equal(task(fleet, task_id).status, 'delivered');
  assert.equal(events.filter((e) => e.type === 'battery_fault').length, 1, 'demo fault fires once');

  run(200, () => robot(fleet, 'robot_2').phase === 'docked');
  const idle = events.filter((e) => e.type === 'robot_idle' && e.robotId === 'robot_2');
  assert.ok(idle.length >= 1);
  const opts = optionsFor('hk1', fleet.snapshot());
  assert.ok(opts.some((o) => o.action === 'assign' && o.robot === 'robot_2'));
  run(200, () => robot(fleet, 'robot_1').phase === 'charging');
  assert.equal(robot(fleet, 'robot_1').phase, 'charging');
});

test('cancel while en route → robot returns, no delivered event', () => {
  const { fleet, events, run } = setup();
  const { task_id } = fleet.createTask({ item: 'towel', qty: 2, room: '1205', callId: 'c1' });
  fleet.apply({ assign: task_id, to: 'robot_1', reason: '' });
  run(60, () => robot(fleet, 'robot_1').phase === 'to_room');
  assert.equal(fleet.cancelTask(task_id), true);
  assert.equal(robot(fleet, 'robot_1').phase, 'returning');
  run(200, () => robot(fleet, 'robot_1').phase === 'docked');
  assert.equal(task(fleet, task_id).status, 'cancelled');
  assert.equal(events.some((e) => e.type === 'delivered'), false);
  assert.equal(fleet.cancelTask(task_id), false);
});

test('snapshot → restore mid-delivery resumes to completion', () => {
  const a = setup();
  const { task_id } = a.fleet.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c1' });
  a.fleet.apply({ assign: task_id, to: 'robot_1', reason: '' });
  a.run(60, () => robot(a.fleet, 'robot_1').phase === 'to_room');
  const snap = JSON.parse(JSON.stringify(a.fleet.snapshot()));

  const clock = { now: a.clock.now };
  const fleet = Fleet.restore(snap, () => clock.now);
  const sim = new FakeSim();
  for (const r of fleet.robots) sim.teleport(r.id, r.pose);
  assert.equal(robot(fleet, 'robot_1').phase, 'to_room');
  for (let t = 0; t < 200 && task(fleet, task_id).status !== 'delivered'; t += 0.05) {
    sim.step(0.05); clock.now += 50; fleet.tick(0.05, sim);
  }
  assert.equal(task(fleet, task_id).status, 'delivered');
});

test('getTask reports status, robot and a counting-down ETA', () => {
  const { fleet, run } = setup();
  const { task_id, eta_seconds } = fleet.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c1' });
  fleet.apply({ assign: task_id, to: 'robot_1', reason: '' });
  run(10);
  const v = fleet.getTask(task_id)!;
  assert.equal(v.robot, 'robot_1');
  assert.ok(v.eta_seconds <= eta_seconds - 9 && v.eta_seconds >= 0);
  assert.equal(fleet.getTask('nope'), null);
});

test('two robots sent to pickup at once take turns and both deliver', () => {
  const { fleet, run } = setup();
  const a = fleet.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c1' }).task_id;
  const b = fleet.createTask({ item: 'pillow', qty: 1, room: '803', callId: 'c2' }).task_id;
  assert.ok(fleet.apply({ assign: a, to: 'robot_1', reason: '' }).ok);
  assert.ok(fleet.apply({ assign: b, to: 'robot_2', reason: '' }).ok);
  let bothLoading = false;
  run(200, () => {
    bothLoading ||= fleet.robots.every((r) => r.phase === 'loading');
    return task(fleet, a).status === 'delivered' && task(fleet, b).status === 'delivered';
  });
  assert.equal(bothLoading, false, 'never two robots at the pickup');
  assert.equal(task(fleet, a).status, 'delivered');
  assert.equal(task(fleet, b).status, 'delivered');
});

test('robots never touch: they stay over 0.34 m (the tower diameter) apart', () => {
  const { fleet, run } = setup({ demoFault: true });
  fleet.seedDemo();
  const { task_id } = fleet.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c1' });
  fleet.apply({ assign: task_id, to: 'robot_1', reason: '' });
  let minGap = Infinity;
  let where = '';
  run(150, () => {
    const [p, q] = fleet.robots.map((r) => r.pose);
    const gapNow = Math.hypot(p.x - q.x, p.y - q.y);
    if (gapNow < minGap) where = fleet.robots.map((r) => `${r.id} ${r.phase} wp${r.wp}/${r.path.length} ${r.pose.x.toFixed(2)},${r.pose.y.toFixed(2)}`).join(' | ');
    minGap = Math.min(minGap, gapNow);
    const opts = optionsFor(task_id, fleet.snapshot());
    const h = opts.find((o) => o.action === 'handoff');
    if (h && h.action === 'handoff') fleet.apply({ handoff: task_id, to: 'robot_2', preempt: h.preempts, reason: '' });
    return task(fleet, task_id).status === 'delivered';
  });
  assert.equal(task(fleet, task_id).status, 'delivered');
  assert.ok(minGap > 0.34, `closest approach ${minGap.toFixed(2)} m: ${where}`);
});

test('housekeeping finishes: the robot comes home from 1205 and is free again', () => {
  const { fleet, events, run } = setup();
  fleet.seedDemo();
  run(300, () => robot(fleet, 'robot_2').phase === 'at_room');
  assert.equal(robot(fleet, 'robot_2').phase, 'at_room');
  run(300, () => robot(fleet, 'robot_2').phase === 'docked');
  assert.equal(robot(fleet, 'robot_2').phase, 'docked');
  assert.equal(task(fleet, 'hk1').status, 'delivered');
  assert.equal(robot(fleet, 'robot_2').taskId, null);
  assert.ok(events.some((e) => e.type === 'robot_idle' && e.robotId === 'robot_2'));
});
