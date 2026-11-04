import test from 'node:test';
import assert from 'node:assert/strict';
import { describe as line } from './describe.ts';
import { planSteps, optionLabel } from './describe.ts';

test('handoff line names both robots, the paused task and the reason', () => {
  assert.equal(
    line({ type: 'battery_fault', robotId: 'robot_1', taskId: 't1', battery: 9 }, { handoff: 't1', to: 'robot_2', preempt: 'hk1', reason: '43 s vs 634 s' }),
    'Battery fault on robot 1 → t1 handed to robot 2, hk1 paused (43 s vs 634 s)',
  );
});

test('assign on a new order and on a freed robot', () => {
  assert.equal(line({ type: 'task_created', taskId: 't1' }, { assign: 't1', to: 'robot_1', reason: 'robot 2 busy' }), 'New order t1 → robot 1 (robot 2 busy)');
  assert.equal(line({ type: 'robot_idle', robotId: 'robot_2' }, { assign: 'hk1', to: 'robot_2', reason: 'queue' }), 'Robot 2 free → hk1 resumed on robot 2 (queue)');
});

test('charge line carries the ETA in minutes', () => {
  assert.equal(
    line({ type: 'battery_fault', robotId: 'robot_1', taskId: 't1', battery: 9 }, { charge_then_continue: 't1', reason: 'no robot free' }, 634),
    'Battery fault on robot 1 → charging first, ETA +11 min (no robot free)',
  );
});

test('wait line', () => {
  assert.equal(line({ type: 'task_created', taskId: 't2' }, { wait: 't2', reason: 'no robot free' }), 't2 waiting for a free robot (no robot free)');
});

test('plan for a battery-fault handoff spells out every consequence', () => {
  const steps = planSteps({ type: 'battery_fault', robotId: 'robot_1', taskId: 't1', battery: 9 }, { handoff: 't1', to: 'robot_2', preempt: 'hk1', reason: '' }, '804', 45);
  assert.deepEqual(steps, [
    'Robot 1 stops and goes home to charge',
    'Robot 2 pauses hk1, which goes back in the queue',
    'Robot 2 goes to the pickup and loads t1',
    'Robot 2 reaches room 804 in about 45 s',
    'Room 804 is told about the delay',
    'hk1 resumes as soon as a robot is free',
  ]);
});

test('option rows: an infeasible option says why and has no ETA', () => {
  assert.deepEqual(optionLabel({ action: 'continue', eta_s: 12, feasible: false, why: 'needs 16%, has 9%' }), { text: 'Carry on: not enough battery, needs 16%, has 9%', eta: 'no' });
  assert.deepEqual(optionLabel({ action: 'charge_then_continue', eta_s: 634 }), { text: 'Charge first, then carry on', eta: '11 min' });
  assert.deepEqual(optionLabel({ action: 'handoff', to: 'robot_2', eta_s: 45, preempts: 'hk1' }), { text: 'Hand off to robot 2, pausing hk1', eta: '45 s' });
});
