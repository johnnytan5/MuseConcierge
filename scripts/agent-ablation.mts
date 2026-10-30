// Latency/correctness ablation for the call agent: model x reasoning effort x
// prompt nudge, over the four turns a room-service call actually has.
//   node --env-file=.env scripts/agent-ablation.mts [reps=3]
import { TOOL_DEFS } from '../lib/agent/tools.ts';
import { systemPrompt } from '../lib/agent/prompt.ts';
import { loadInventory, deliverable } from '../lib/inventory.ts';
import type { ChatMessage, AssistantMessage } from '../lib/meta/client.ts';

const REPS = Number(process.argv[2] ?? 3);

type Config = { name: string; model: string; effort?: string; nudge?: boolean };
const CONFIGS: Config[] = [
  { name: '1.3 low', model: 'muse-spark-1.3', effort: 'low' },
  { name: '1.3 minimal', model: 'muse-spark-1.3', effort: 'minimal' },
  { name: '1.3 minimal+nudge', model: 'muse-spark-1.3', effort: 'minimal', nudge: true },
  { name: '1.3-contrib minimal', model: 'muse-spark-1.3-contributor', effort: 'minimal' },
  { name: '1.2 minimal', model: 'muse-spark-1.2', effort: 'minimal' },
  { name: '1.1 minimal', model: 'muse-spark-1.1', effort: 'minimal' },
  { name: '1.1 minimal+nudge', model: 'muse-spark-1.1', effort: 'minimal', nudge: true },
];
// ONLY="1.1 minimal,1.3 minimal+nudge" runs a subset.
const only = process.env.ONLY?.split(',');

const ask = 'Hi, can I get two towels to room 804?';
const readBack: ChatMessage = { role: 'assistant', content: 'Two towels to room 804, is that right?' };
const toolCall = (id: string, name: string, args: object): ChatMessage =>
  ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

type Scenario = { name: string; messages: ChatMessage[]; pass(m: AssistantMessage): boolean };
const call = (m: AssistantMessage, name: string) => m.tool_calls?.find((c) => c.function.name === name);
const SCENARIOS: Scenario[] = [
  {
    name: 'read back',
    messages: [{ role: 'user', content: ask }],
    pass: (m) => !m.tool_calls?.length && /804|eight.?(oh|zero|o).?four/i.test(m.content ?? ''),
  },
  {
    name: 'create task',
    messages: [{ role: 'user', content: ask }, readBack, { role: 'user', content: "Yes, that's right." }],
    pass: (m) => {
      const c = call(m, 'create_task');
      if (!c) return false;
      const a = JSON.parse(c.function.arguments);
      return /towel/.test(a.item) && String(a.room) === '804' && Number(a.qty) === 2;
    },
  },
  {
    name: 'clarify item',
    messages: [
      { role: 'user', content: 'Can I get some water to room 805? Yes, 805.' },
      toolCall('c1', 'create_task', { item: 'water', qty: 1, room: '805' }),
      { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ error: '"water" could mean still water or sparkling water; ask which.' }) },
    ],
    pass: (m) => !m.tool_calls?.length && /still/i.test(m.content ?? '') && /sparkling/i.test(m.content ?? ''),
  },
  {
    name: 'hang up',
    messages: [
      { role: 'user', content: ask }, readBack, { role: 'user', content: 'Yes.' },
      toolCall('c1', 'create_task', { item: 'towel', qty: 2, room: '804' }),
      { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ task_id: 't1', eta_seconds: 130, item: 'towel', qty: 2, room: '804' }) },
      { role: 'assistant', content: 'Two towels are on the way to 804, about 3 minutes. Anything else?' },
      { role: 'user', content: "No, that's all, thanks." },
    ],
    pass: (m) => !!call(m, 'end_call'),
  },
];

const items = deliverable(await loadInventory());
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows: string[] = [];

for (const cfg of CONFIGS.filter((c) => !only || only.includes(c.name))) {
  const ms: number[] = [];
  const reasoning: number[] = [];
  let passed = 0;
  let total = 0;
  const fails: string[] = [];
  for (const sc of SCENARIOS) {
    for (let r = 0; r < REPS; r++) {
      total++;
      const t0 = Date.now();
      const res = await fetch('https://api.meta.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.META_API_KEY}` },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 1000,
          tools: TOOL_DEFS,
          ...(cfg.effort ? { reasoning_effort: cfg.effort } : {}),
          messages: [{ role: 'system', content: systemPrompt(items, !!cfg.nudge) }, ...sc.messages],
        }),
      });
      const j = await res.json();
      ms.push(Date.now() - t0);
      if (j.error) { fails.push(`${sc.name}: ${j.error.message.slice(0, 60)}`); continue; }
      reasoning.push(j.usage?.completion_tokens_details?.reasoning_tokens ?? 0);
      const m = j.choices[0].message as AssistantMessage;
      if (sc.pass(m)) passed++;
      else fails.push(`${sc.name}: ${m.tool_calls?.map((c) => c.function.name + c.function.arguments).join() ?? m.content}`);
    }
  }
  const row = `| ${cfg.name} | ${passed}/${total} | ${median(ms)} ms | ${Math.max(...ms)} ms | ${median(reasoning)} |`;
  rows.push(row);
  console.log(row);
  for (const f of fails) console.log(`    fail ${f}`);
}

console.log('\n| Config | Correct | Median | Worst | Median reasoning tokens |\n|---|---|---|---|---|');
for (const r of rows) console.log(r);
