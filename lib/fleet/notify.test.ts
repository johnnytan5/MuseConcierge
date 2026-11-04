import test from 'node:test';
import assert from 'node:assert/strict';
import { notification } from './notify.ts';
import type { Task } from './types.ts';

const guest = { id: 't1', kind: 'guest', room: '804' } as Task;
const hk = { id: 'hk1', kind: 'housekeeping', room: '1205' } as Task;

test('assign → On the way with minutes rounded, at least 1', () => {
  assert.deepEqual(notification({ type: 'task_created', taskId: 't1' }, { assign: 't1', to: 'robot_1', reason: '' }, guest, 26), { room: '804', text: 'On the way, about 1 min' });
  assert.deepEqual(notification({ type: 'task_created', taskId: 't1' }, { assign: 't1', to: 'robot_1', reason: '' }, guest, 130), { room: '804', text: 'On the way, about 2 min' });
});

test('handoff or charge → Delayed', () => {
  const fault = { type: 'battery_fault', robotId: 'robot_1', taskId: 't1', battery: 9 } as const;
  assert.deepEqual(notification(fault, { handoff: 't1', to: 'robot_2', preempt: 'hk1', reason: '' }, guest, 43), { room: '804', text: 'Delayed, about 1 min' });
  assert.deepEqual(notification(fault, { charge_then_continue: 't1', reason: '' }, guest, 634), { room: '804', text: 'Delayed, about 11 min' });
});

test('delivered → Arrived', () => {
  assert.deepEqual(notification({ type: 'delivered', taskId: 't1', robotId: 'robot_2' }, null, guest), { room: '804', text: 'Arrived' });
});

test('housekeeping and wait → no guest notification', () => {
  assert.equal(notification({ type: 'delivered', taskId: 'hk1', robotId: 'robot_2' }, null, hk), null);
  assert.equal(notification({ type: 'task_created', taskId: 't1' }, { wait: 't1', reason: '' }, guest), null);
});
