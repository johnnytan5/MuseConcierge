import test from 'node:test';
import assert from 'node:assert/strict';
import { argLines, flowActions, flowOutcomes, replyMs } from './flow.ts';

const muse = [
  { tool_name: 'create_task', result: { task_id: 't1' } },
  { tool_name: 'brain_decision', result: { assign: 't1' } },
  { tool_name: 'brain_decision', result: { handoff: 't1' } },
  { tool_name: 'door_check', result_summary: 'Plate reads 804: confirmed' },
  { tool_name: 'cabin_check' },
  { tool_name: 'cabin_check' },
  { tool_name: 'collection' },
  { tool_name: 'end_call' },
];

test('flow counts what the call did, by group', () => {
  const a = Object.fromEntries(flowActions(muse).map((n) => [n.label, n.count]));
  assert.equal(a['Order handling'], 1);
  assert.equal(a['Fleet planning'], 2);
  assert.equal(a['Delivery checks'], 3);
  assert.equal(a['Hand-overs'], 1);
  assert.equal(a['Escalated to desk'], 0);
});

test('flow outcomes tell how it ended', () => {
  assert.deepEqual(flowOutcomes(muse).map((n) => n.label), ['Order placed', 'Handed to another robot', 'Right door confirmed', 'Collected by the guest']);
  assert.deepEqual(flowOutcomes([{ tool_name: 'door_check', result_summary: 'Plate reads 806: wrong door' }]).map((n) => n.label), ['Door not confirmed']);
  assert.deepEqual(flowOutcomes([{ tool_name: 'create_task', result: { error: 'no such room' } }]), []);
  assert.equal(flowOutcomes([{ tool_name: 'escalate_to_frontdesk' }])[0].alert, true);
});

test('arguments read as short lines; nested detail is left out', () => {
  assert.deepEqual(argLines({ item: 'towel', qty: 2, also: [{ item: 'uber eats order', qty: 1 }], room: '804' }), [
    { k: 'item', v: 'towel' }, { k: 'qty', v: '2' }, { k: 'also', v: '1× uber eats order' }, { k: 'room', v: '804' },
  ]);
  assert.deepEqual(argLines({ event: { type: 'x' }, options: [{ action: 'wait' }], task: 't1' }), [{ k: 'task', v: 't1' }]);
  assert.deepEqual(argLines(null), []);
});

test('reply time counts from the last thing the guest said', () => {
  assert.equal(replyMs(5000, [1000, 4000]), 1000);
  assert.equal(replyMs(500, [1000]), null);
});
