import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics } from './metrics.ts';
import type { FleetSnapshot, Task } from './types.ts';

const t = (o: Partial<Task>): Task => ({
  id: 't', kind: 'guest', priority: 'high', item: 'towel', qty: 1, room: '804', callId: null, status: 'queued',
  robotId: null, etaAt: null, createdAt: 0, deliveredAt: null, history: [], ...o,
});
const snap = (tasks: Task[]) => ({ now: 0, seq: 0, faultFired: false, robots: [], tasks }) as FleetSnapshot;

test('avgDeliveryS averages guest deliveries only', () => {
  const m = metrics(snap([
    t({ status: 'delivered', createdAt: 0, deliveredAt: 60_000 }),
    t({ status: 'delivered', createdAt: 10_000, deliveredAt: 130_000 }),
    t({ status: 'en_route' }),
    t({ kind: 'housekeeping', status: 'delivered', createdAt: 0, deliveredAt: 999_000 }),
  ]));
  assert.equal(m.delivered, 2);
  assert.equal(m.avgDeliveryS, 90);
});

test('null average when nothing delivered', () => {
  assert.equal(metrics(snap([t({})])).avgDeliveryS, null);
});

test('handoffs counts reassigned history entries', () => {
  const m = metrics(snap([t({ history: [{ at: 0, status: 'assigned', robotId: 'robot_1' }, { at: 1, status: 'reassigned', robotId: 'robot_2' }] })]));
  assert.equal(m.handoffs, 1);
});
