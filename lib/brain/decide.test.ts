import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecision, fallbackDecision, decisionFor } from './decide.ts';
import type { Option } from '../fleet/types.ts';

const FAULT: Option[] = [
  { action: 'continue', eta_s: 6, feasible: false, why: 'needs 16%, has 9%' },
  { action: 'charge_then_continue', eta_s: 634 },
  { action: 'handoff', to: 'robot_2', eta_s: 43, preempts: 'hk1' },
];

test('parseDecision accepts a handoff present in the options', () => {
  assert.deepEqual(
    parseDecision('{"handoff":"t1","to":"robot_2","preempt":"hk1","reason":"guest beats housekeeping"}', 't1', FAULT),
    { handoff: 't1', to: 'robot_2', preempt: 'hk1', reason: 'guest beats housekeeping' },
  );
});

test('parseDecision strips a json fence and surrounding prose', () => {
  const d = parseDecision('Sure.\n```json\n{"handoff":"t1","to":"robot_2","preempt":"hk1","reason":"faster"}\n```', 't1', FAULT);
  assert.equal(d && 'handoff' in d && d.to, 'robot_2');
});

test('parseDecision rejects decisions not offered', () => {
  assert.equal(parseDecision('{"handoff":"t1","to":"robot_1","preempt":null,"reason":"x"}', 't1', FAULT), null);
  assert.equal(parseDecision('{"handoff":"t1","to":"robot_2","preempt":null,"reason":"x"}', 't1', FAULT), null, 'wrong preempt');
  assert.equal(parseDecision('{"continue":"t1","reason":"x"}', 't1', FAULT), null, 'infeasible continue');
  assert.equal(parseDecision('{"handoff":"t9","to":"robot_2","preempt":"hk1","reason":"x"}', 't1', FAULT), null, 'other task');
  assert.equal(parseDecision('{"assign":"t1","to":"robot_2","reason":"x"}', 't1', FAULT), null);
});

test('parseDecision rejects prose and broken JSON', () => {
  assert.equal(parseDecision('Hand it to robot 2.', 't1', FAULT), null);
  assert.equal(parseDecision('{"handoff": "t1", "to": ', 't1', FAULT), null);
});

test('parseDecision caps the reason length', () => {
  const d = parseDecision(JSON.stringify({ charge_then_continue: 't1', reason: 'x'.repeat(500) }), 't1', FAULT);
  assert.ok(d && d.reason.length <= 120);
});

test('fallback picks the fastest feasible option and never an infeasible continue', () => {
  assert.deepEqual(fallbackDecision('t1', FAULT), { handoff: 't1', to: 'robot_2', preempt: 'hk1', reason: 'fastest option (43 s)' });
  const noHandoff = FAULT.filter((o) => o.action !== 'handoff');
  assert.deepEqual(fallbackDecision('t1', noHandoff), { charge_then_continue: 't1', reason: 'fastest option (634 s)' });
  assert.deepEqual(fallbackDecision('t2', [{ action: 'wait' }]), { wait: 't2', reason: 'no robot free' });
});

test('decisionFor maps an option to its decision shape', () => {
  assert.deepEqual(decisionFor('t3', { action: 'assign', robot: 'robot_1', eta_s: 26 }, 'idle'), { assign: 't3', to: 'robot_1', reason: 'idle' });
});
