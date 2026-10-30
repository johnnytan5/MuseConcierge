// Asks the brain model the demo's two questions (new order, battery fault)
// directly, a few times each, and reports choice and latency per setting.
//   node --env-file=.env scripts/brain-check.mts [reps=3]
import { chat } from '../lib/meta/client.ts';
import { BRAIN_SYSTEM, brainQuestion } from '../lib/brain/prompt.ts';
import { parseDecision } from '../lib/brain/decide.ts';
import { Fleet } from '../lib/fleet/engine.ts';
import { optionsFor } from '../lib/fleet/options.ts';
import { NODES } from '../lib/fleet/nav.ts';

const REPS = Number(process.argv[2] ?? 3);
const f = new Fleet(() => 0);
f.seedDemo();
const t1 = f.createTask({ item: 'towel', qty: 2, room: '804', callId: 'c' }).task_id;
const qNew = { event: { type: 'task_created', taskId: t1 } as const, options: optionsFor(t1, f.snapshot()), snap: f.snapshot() };
f.apply({ assign: t1, to: 'robot_1', reason: '' });
const r1 = f.robots[0];
r1.pose = { x: NODES.fault_point[0], y: NODES.fault_point[1], yaw: 0 };
r1.phase = 'to_room';
f.robots[1].pose = { x: NODES.door_806[0], y: NODES.door_806[1], yaw: 0 };
f.robots[1].phase = 'at_room';
f.injectBatteryFault('robot_1');
const qFault = { event: f.drain().find((e) => e.type === 'battery_fault')!, options: optionsFor(t1, f.snapshot()), snap: f.snapshot() };
console.log('fault options', JSON.stringify(qFault.options));

// CONFIGS=wonder-minimal limits the run.
const ALL = [['muse-wonder-1.0', 'low'], ['muse-wonder-1.0', 'minimal'], ['muse-spark-1.1', 'minimal']] as const;
const only = process.env.CONFIGS?.split(',');
for (const [model, effort] of ALL.filter(([m, e]) => !only || only.includes(`${m.split('-')[1]}-${e}`))) {
  for (const [name, q] of [['new order', qNew], ['battery fault', qFault]] as const) {
    for (let i = 0; i < REPS; i++) {
      const t0 = Date.now();
      try {
        const m = await chat({ model, reasoningEffort: effort, maxTokens: 2000, timeoutMs: 30000, messages: [{ role: 'system', content: BRAIN_SYSTEM }, { role: 'user', content: brainQuestion(q.event, t1, q.options, q.snap) }] });
        const d = parseDecision(m.content ?? '', t1, q.options);
        console.log(`${model} ${effort}`.padEnd(26), name.padEnd(14), `${Date.now() - t0} ms`.padEnd(9), d ? JSON.stringify(d) : `UNUSABLE ${m.content?.slice(0, 80)}`);
      } catch (e) {
        console.log(`${model} ${effort}`.padEnd(26), name.padEnd(14), `${Date.now() - t0} ms`.padEnd(9), 'ERROR', (e as Error).message.slice(0, 80));
      }
    }
  }
}
