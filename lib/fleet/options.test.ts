import test from 'node:test';
import assert from 'node:assert/strict';
import { optionsFor } from './options.ts';
import type { FleetSnapshot, Robot, Task } from './types.ts';
import { NODES } from './nav.ts';

const at = (node: string) => ({ x: NODES[node][0], y: NODES[node][1], yaw: 0 });
const robot = (id: 'robot_1' | 'robot_2', o: Partial<Robot> = {}): Robot =>
  ({ id, phase: 'docked', taskId: null, battery: 80, fault: false, pose: at(id === 'robot_1' ? 'dock_1' : 'dock_2'), path: [], wp: 0, until: 0, ...o });
const task = (id: string, o: Partial<Task> = {}): Task => ({
  id, kind: 'guest', priority: 'high', item: 'towel', qty: 2, room: '804', callId: 'c1', status: 'queued',
  robotId: null, etaAt: null, createdAt: 0, deliveredAt: null, history: [], ...o,
});
const snap = (robots: Robot[], tasks: Task[]): FleetSnapshot => ({ now: 0, seq: 9, faultFired: false, robots, tasks });

// The demo moment: robot 1 faults at fault_point carrying t1; robot 2 is on housekeeping.
const faulted = () => snap(
  [robot('robot_1', { phase: 'halted', taskId: 't1', battery: 9, fault: true, pose: at('fault_point') }),
   robot('robot_2', { phase: 'at_room', taskId: 'hk1', battery: 82, pose: at('door_1205') })],
  [task('t1', { status: 'en_route', robotId: 'robot_1' }),
   task('hk1', { kind: 'housekeeping', priority: 'low', item: 'linen', room: '1205', callId: null, status: 'assigned', robotId: 'robot_2' })],
);

test('battery 9% → continue infeasible with a reason', () => {
  const c = optionsFor('t1', faulted()).find((o) => o.action === 'continue');
  assert.ok(c && c.action === 'continue' && !c.feasible && /needs \d+%/.test(c.why ?? ''));
});

test('handoff to robot_2 preempting low-priority hk1 offered', () => {
  const h = optionsFor('t1', faulted()).find((o) => o.action === 'handoff');
  assert.deepEqual(h && h.action === 'handoff' && [h.to, h.preempts], ['robot_2', 'hk1']);
});

test('handoff eta < charge eta', () => {
  const opts = optionsFor('t1', faulted());
  const h = opts.find((o) => o.action === 'handoff');
  const c = opts.find((o) => o.action === 'charge_then_continue');
  assert.ok(h && c && h.eta_s < c.eta_s);
});

test('no handoff when robot_2 is on a guest task', () => {
  const s = faulted();
  s.tasks[1] = { ...s.tasks[1], kind: 'guest', priority: 'high' };
  assert.equal(optionsFor('t1', s).some((o) => o.action === 'handoff'), false);
  assert.ok(optionsFor('t1', s).some((o) => o.action === 'charge_then_continue'));
});

test('no handoff to a robot whose battery cannot cover the trip', () => {
  const s = faulted();
  s.robots[1] = { ...s.robots[1], battery: 5 };
  assert.equal(optionsFor('t1', s).some((o) => o.action === 'handoff'), false);
});

test('queued task: assign offered for each docked robot with battery, else wait', () => {
  const s = snap([robot('robot_1'), robot('robot_2', { phase: 'to_room', taskId: 'hk1' })], [task('t1')]);
  const opts = optionsFor('t1', s);
  assert.deepEqual(opts.map((o) => o.action === 'assign' && o.robot), ['robot_1']);
  s.robots[0] = { ...s.robots[0], phase: 'to_pickup', taskId: 'x' };
  assert.deepEqual(optionsFor('t1', s), [{ action: 'wait' }]);
});

test('delivered or unknown task → no options', () => {
  assert.deepEqual(optionsFor('nope', faulted()), []);
  const s = faulted();
  s.tasks[0] = { ...s.tasks[0], status: 'delivered' };
  assert.deepEqual(optionsFor('t1', s), []);
});

test('decisionContext: robot_idle picks the high-priority queued task first, then oldest', async () => {
  const { decisionContext } = await import('./options.ts');
  const s = snap([robot('robot_1'), robot('robot_2')], [
    task('hk1', { kind: 'housekeeping', priority: 'low', createdAt: 1 }),
    task('t2', { createdAt: 5 }),
    task('t3', { createdAt: 3 }),
  ]);
  assert.equal(decisionContext({ type: 'robot_idle', robotId: 'robot_2' }, s)?.taskId, 't3');
  assert.equal(decisionContext({ type: 'delivered', taskId: 't3', robotId: 'robot_1' }, s), null);
  assert.equal(decisionContext({ type: 'task_created', taskId: 't2' }, s)?.taskId, 't2');
});
