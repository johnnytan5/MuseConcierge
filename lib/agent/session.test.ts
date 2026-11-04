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

const order = call('create_task', { item: 'towel', qty: 1, room: '804' });

test('a confirmed order asks for anything else and keeps the line open', async (t) => {
  script([{ tool_calls: [order] }, { content: 'On the way, about one minute. Anything else?' }], t);
  const { s, said, ended } = session();
  await s.onGuest('a towel to 804');
  assert.deepEqual(said, ['On the way, about one minute. Anything else?']);
  assert.equal(ended(), 0);
});

test('the question is asked even if the model forgets it', async (t) => {
  script([{ tool_calls: [order] }, { content: 'On the way, about one minute.' }], t);
  const { s, said, ended } = session();
  await s.onGuest('a towel to 804');
  assert.deepEqual(said, ['On the way, about one minute.', 'Is there anything else I can help with?']);
  assert.equal(ended(), 0);
});

test('hanging up right after the order is held back until the guest answers', async (t) => {
  script([{ tool_calls: [order] }, { content: 'On the way.', tool_calls: [call('end_call', {})] }], t);
  const { s, said, ended } = session();
  await s.onGuest('a towel to 804');
  assert.deepEqual(said, ['On the way.', 'Is there anything else I can help with?']);
  assert.equal(ended(), 0);
});

test('"no thanks" ends the call, with a goodbye if the model hangs up silently', async (t) => {
  script([{ tool_calls: [order] }, { content: 'On the way. Anything else?' }, { tool_calls: [call('end_call', {})] }], t);
  const { s, said, ended } = session();
  await s.onGuest('a towel to 804');
  await s.onGuest('no thanks');
  assert.equal(said.at(-1), 'Thank you, have a nice stay.');
  assert.equal(ended(), 1);
});

test('the model never announces the hang-up', async (t) => {
  script([{ tool_calls: [order] }, { content: 'On the way. Anything else?' }, { content: 'I will end the call now.', tool_calls: [call('end_call', {})] }], t);
  const { s, said, ended } = session();
  await s.onGuest('a towel to 804');
  await s.onGuest('no thanks');
  assert.deepEqual(said.slice(-1), ['Thank you, have a nice stay.']);
  assert.ok(!said.some((x) => /end the call/.test(x)));
  assert.equal(ended(), 1);
});

test('"no thanks" ends the call even if the model never calls end_call', async (t) => {
  script([{ tool_calls: [order] }, { content: 'On the way. Anything else?' }, { content: 'Enjoy your stay.' }], t);
  const { s, ended } = session();
  await s.onGuest('a towel to 804');
  await s.onGuest('no thanks');
  assert.equal(ended(), 1);
});

test('a follow-up answer does not hang up on the guest', async (t) => {
  script([{ tool_calls: [order] }, { content: 'On the way. Anything else?' }, { content: 'The pool opens at seven.' }], t);
  const { s, ended } = session();
  await s.onGuest('a towel to 804');
  await s.onGuest('when does the pool open');
  assert.equal(ended(), 0);
});

test('an escalation also asks for anything else', async (t) => {
  script([{ tool_calls: [call('escalate_to_frontdesk', { reason: 'late checkout' })] }, { content: 'The front desk will follow up.' }], t);
  const { s, said, ended } = session();
  await s.onGuest('can I check out late');
  assert.equal(said.at(-1), 'Is there anything else I can help with?');
  assert.equal(ended(), 0);
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
