// Plays a scripted guest through CallSession against the running dev server
// and a stub fleet, printing each turn with its Muse Spark latency.
//   npm run dev   # in another terminal
//   node scripts/call-check.mts
import { CallSession } from '../lib/agent/session.ts';
import type { FleetApi } from '../lib/agent/tools.ts';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const LINES = (process.env.GUEST_LINES ?? 'Hi, can I get two towels to room 804?|Yes, 804.|No, that is all, thanks.').split('|');

const created: unknown[] = [];
const fleet: FleetApi = {
  createTask(i) { created.push(i); return { task_id: 't1', eta_seconds: 130 }; },
  getTask: () => null,
  cancelTask: () => false,
};
const { items } = await (await fetch(`${BASE}/api/inventory`)).json();

let ended = false;
const call = new CallSession('check', fleet, items, {
  agentUrl: `${BASE}/api/agent`,
  room: process.env.ROOM,
  escalate: () => {},
  onSay: async () => {},
  onEnd: () => { ended = true; },
  onLog: (e) => console.log(e.kind.padEnd(5), JSON.stringify({ ...e, kind: undefined })),
});
for (const line of LINES) {
  if (ended) break;
  await call.onGuest(line);
}
console.log(ended && created.length <= 1 ? `OK ${created.length} task, call ended` : `CHECK created=${created.length} ended=${ended}`);
