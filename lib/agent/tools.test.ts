import test from 'node:test';
import assert from 'node:assert/strict';
import { runTool, matchItem, type FleetApi } from './tools.ts';

const ITEMS = ['towel', 'bath towel set', 'still water', 'sparkling water', 'toothbrush', 'extra pillow'];

function stubFleet(): FleetApi & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    createTask(i) { created.push(i); return { task_id: 't1', eta_seconds: 130 }; },
    getTask(id) { return id === 't1' ? { task_id: 't1', status: 'en_route', room: '804', item: 'towel', qty: 2, eta_seconds: 90, robot: 'robot_1' } : null; },
    cancelTask(id) { return id === 't1'; },
  };
}
const ctx = { callId: 'c1', items: ITEMS };

test('matchItem: plural and exact names', async () => {
  assert.deepEqual(matchItem('Towels', ITEMS), { item: 'towel' });
  assert.deepEqual(matchItem('extra pillows', ITEMS), { item: 'extra pillow' });
  assert.deepEqual(matchItem('pillow', ITEMS), { item: 'extra pillow' });
});

test('matchItem: ambiguous and unknown', async () => {
  assert.deepEqual(matchItem('water', ITEMS), { candidates: ['still water', 'sparkling water'] });
  assert.deepEqual(matchItem('umbrella', ITEMS), { candidates: [] });
});

test('create_task rejects room 84', async () => {
  const r = await runTool('create_task', { item: 'towel', qty: 2, room: '84' }, stubFleet(), ctx) as { error: string };
  assert.match(r.error, /room/);
});

test('create_task rejects item not in inventory', async () => {
  const r = await runTool('create_task', { item: 'umbrella', qty: 1, room: '804' }, stubFleet(), ctx) as { error: string };
  assert.match(r.error, /umbrella/);
});

test('create_task asks to clarify an ambiguous item', async () => {
  const r = await runTool('create_task', { item: 'water', qty: 1, room: '804' }, stubFleet(), ctx) as { error: string };
  assert.match(r.error, /still water.*sparkling water/);
});

test('create_task returns task_id and eta_seconds immediately', async () => {
  const fleet = stubFleet();
  const r = await runTool('create_task', { item: 'towels', qty: 2, room: '804' }, fleet, ctx);
  assert.deepEqual(r, { task_id: 't1', eta_seconds: 130, item: 'towel', qty: 2, room: '804' });
  assert.deepEqual(fleet.created, [{ item: 'towel', qty: 2, room: '804', callId: 'c1' }]);
});

test('create_task clamps qty to 1..5', async () => {
  const fleet = stubFleet();
  await runTool('create_task', { item: 'towel', qty: 40, room: '804' }, fleet, ctx);
  assert.equal((fleet.created[0] as { qty: number }).qty, 5);
});

test('get_task_status unknown id → error', async () => {
  assert.ok('error' in await runTool('get_task_status', { task_id: 'nope' }, stubFleet(), ctx));
  assert.equal((await runTool('get_task_status', { task_id: 't1' }, stubFleet(), ctx) as { status: string }).status, 'en_route');
});

test('cancel_task → {cancelled: true}', async () => {
  assert.deepEqual(await runTool('cancel_task', { task_id: 't1' }, stubFleet(), ctx), { cancelled: true });
  assert.ok('error' in await runTool('cancel_task', { task_id: 'nope' }, stubFleet(), ctx));
});

test('hotel_info answers from the fact sheet, and an unknown topic says to escalate', async () => {
  const r = await runTool('hotel_info', { topic: 'facilities' }, stubFleet(), ctx) as { answer: string };
  assert.match(r.answer, /Pool on level 5, open 7am to 9pm/);
  const none = await runTool('hotel_info', { topic: 'spa' }, stubFleet(), ctx) as { error: string };
  assert.match(none.error, /escalate_to_frontdesk/);
  assert.ok('error' in await runTool('hotel_info', { topic: 'constructor' }, stubFleet(), ctx));
});

test('end_call → {ended: true}; unknown tool → error', async () => {
  assert.deepEqual(await runTool('end_call', {}, stubFleet(), ctx), { ended: true });
  assert.ok('error' in await runTool('fly', {}, stubFleet(), ctx));
});

test('create_task goes to the room the call came from unless the guest names another', async () => {
  const fleet = stubFleet();
  const here = { ...ctx, room: '1204' };
  await runTool('create_task', { item: 'towel', qty: 1 }, fleet, here);
  await runTool('create_task', { item: 'towel', qty: 1, room: '803' }, fleet, here);
  assert.deepEqual((fleet.created as { room: string }[]).map((c) => c.room), ['1204', '803']);
});
