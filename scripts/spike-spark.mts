// Smoke test: Muse Spark returns a create_task tool call for a plain request.
//   node --env-file=.env scripts/spike-spark.mts
import { chat, MODELS, type ToolDef } from '../lib/meta/client.ts';

const createTask: ToolDef = {
  type: 'function',
  function: {
    name: 'create_task',
    description: 'Queue a delivery to a guest room.',
    parameters: {
      type: 'object',
      properties: { item: { type: 'string' }, qty: { type: 'integer' }, room: { type: 'string' } },
      required: ['item', 'qty', 'room'],
    },
  },
};

const t0 = performance.now();
const msg = await chat({
  model: MODELS.spark,
  messages: [
    { role: 'system', content: 'You are a hotel concierge. Use tools to fulfil requests.' },
    { role: 'user', content: 'Send two towels to room 804.' },
  ],
  tools: [createTask],
});
const call = msg.tool_calls?.[0];
if (call?.function.name !== 'create_task' || !call.function.arguments.includes('804')) {
  console.error('FAIL', JSON.stringify(msg));
  process.exit(1);
}
console.log('OK create_task', call.function.arguments, `${Math.round(performance.now() - t0)} ms`);
