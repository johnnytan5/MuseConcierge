import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, startCall } from './limits.ts';
import { callLimit } from './call-limit.ts';

test('clientIp takes the first x-forwarded-for hop', () => {
  assert.equal(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } })), '203.0.113.7');
  assert.equal(clientIp(new Request('http://x', { headers: { 'x-real-ip': '198.51.100.2' } })), '198.51.100.2');
  assert.equal(clientIp(new Request('http://x')), 'unknown');
});

const LIMIT_ENV = ['NODE_ENV', 'NEXT_PUBLIC_CALL_LIMIT_ENABLED', 'NEXT_PUBLIC_CALLS_PER_IP_PER_DAY'];

function setup(t: { after: (fn: () => void) => void }, env: Record<string, string>, used: number) {
  const saved = Object.fromEntries(LIMIT_ENV.map((k) => [k, process.env[k]]));
  const real = globalThis.fetch;
  const calls: { url: string; body?: string }[] = [];
  for (const k of LIMIT_ENV) delete process.env[k];
  Object.assign(process.env, { NODE_ENV: 'production', ...env });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body as string | undefined });
    return new Response('[]', { headers: { 'content-range': `0-0/${used}` } });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
    for (const k of LIMIT_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
  return calls;
}

const req = () => new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.7' } });

test('call limit settings: defaults, toggle and bad values', (t) => {
  setup(t, {}, 0);
  assert.deepEqual(callLimit(), { enabled: true, perDay: 3 });
  process.env.NEXT_PUBLIC_CALL_LIMIT_ENABLED = 'false';
  process.env.NEXT_PUBLIC_CALLS_PER_IP_PER_DAY = '20';
  assert.deepEqual(callLimit(), { enabled: false, perDay: 20 });
  process.env.NEXT_PUBLIC_CALL_LIMIT_ENABLED = 'true';
  process.env.NEXT_PUBLIC_CALLS_PER_IP_PER_DAY = 'lots';
  assert.deepEqual(callLimit(), { enabled: true, perDay: 3 });
});

test('the configured number is the limit', async (t) => {
  setup(t, { NEXT_PUBLIC_CALLS_PER_IP_PER_DAY: '5' }, 5);
  assert.deepEqual(await startCall(req(), 'v'), { error: 'Daily limit reached (5 calls). Try again tomorrow.', status: 429 });
  const under = setup(t, { NEXT_PUBLIC_CALLS_PER_IP_PER_DAY: '6' }, 5);
  assert.ok('callId' in (await startCall(req(), 'v')));
  assert.match(under.at(-1)!.body!, /203\.0\.113\.7/);
});

test('with the limit off, a used-up IP still starts, the call is recorded, the IP is not', async (t) => {
  const calls = setup(t, { NEXT_PUBLIC_CALL_LIMIT_ENABLED: 'false' }, 999);
  assert.ok('callId' in (await startCall(req(), 'v')));
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].body!, /203\.0\.113\.7/);
});
