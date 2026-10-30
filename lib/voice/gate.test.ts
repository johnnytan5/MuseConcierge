import test from 'node:test';
import assert from 'node:assert/strict';
import { Gate } from './gate.ts';

test('gate blocks mic while speaking and 300ms after', () => {
  let now = 0;
  const g = new Gate(() => now);
  assert.equal(g.shouldSend(), true);
  g.start();
  assert.equal(g.shouldSend(), false);
  now = 1000; g.end();
  now = 1200; assert.equal(g.shouldSend(), false);
  now = 1301; assert.equal(g.shouldSend(), true);
});
