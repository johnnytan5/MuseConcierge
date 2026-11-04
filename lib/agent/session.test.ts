import test from 'node:test';
import assert from 'node:assert/strict';
import { CallSession } from './session.ts';
import type { FleetApi } from './tools.ts';

const fleet: FleetApi = {
  createTask: () => ({ task_id: 't1', eta_seconds: 60 }),
  getTask: () => null,
  cancelTask: () => true,
};

const call = (name: string, args: object) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } });

// A fake model: one scripted reply per request.
function script(replies: object[], t: { after: (fn: () => void) => void }) {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ message: { role: 'assistant', content: null, ...replies.shift() }, ms: 1 })) as typeof fetch;
  t.after(() => { globalThis.fetch = real; });
}

const session = () => {
  const said: string[] = [];
  let ended = 0;
  const s = new CallSession('c', fleet, ['towel'], { onSay: async (x) => { said.push(x); }, onEnd: () => { ended++; } });
  return { s, said, ended: () => ended };
};

test('a confirmed order ends the call even if the model never calls end_call', async (t) => {
  script([{ tool_calls: [call('create_task', { item: 'towel', qty: 1, room: '804' })] }, { content: 'On the way, about one minute.' }], t);
  const { s, said, ended } = session();
  await s.onGuest('yes, that is right');
  assert.deepEqual(said, ['On the way, about one minute.']);
  assert.equal(ended(), 1);
});

test('a read-back does not end the call', async (t) => {
  script([{ content: 'That is room 804?' }], t);
  const { s, ended } = session();
  await s.onGuest('a towel to 804');
  assert.equal(ended(), 0);
});

test('a failed order keeps the call open so the agent can ask again', async (t) => {
  script([{ tool_calls: [call('create_task', { item: 'towel', qty: 1, room: '999' })] }, { content: 'Which room was that?' }], t);
  const { s, ended } = session();
  await s.onGuest('a towel to 999');
  assert.equal(ended(), 0);
});
