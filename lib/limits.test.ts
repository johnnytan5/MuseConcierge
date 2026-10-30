import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from './limits.ts';

test('clientIp takes the first x-forwarded-for hop', () => {
  assert.equal(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } })), '203.0.113.7');
  assert.equal(clientIp(new Request('http://x', { headers: { 'x-real-ip': '198.51.100.2' } })), '198.51.100.2');
  assert.equal(clientIp(new Request('http://x')), 'unknown');
});
