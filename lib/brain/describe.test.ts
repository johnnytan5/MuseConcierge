import test from 'node:test';
import assert from 'node:assert/strict';
import { describe as line } from './describe.ts';

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
