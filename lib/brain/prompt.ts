// The brain sees one event, the fleet in brief, and the engine's options.
// It answers with one JSON object; the console writes the human-readable line.
import type { FleetEvent, FleetSnapshot, Option } from '../fleet/types.ts';

export const BRAIN_SYSTEM = `You are the dispatcher for a hotel's delivery robots. The task engine asks you one question at a time and lists every option it can execute, each with an ETA it computed. Pick exactly one option.

Priorities:
1. Guest orders (priority high) come before housekeeping (priority low). Pausing housekeeping for a guest is fine.
2. Among options that respect that, prefer the lowest eta_s.
3. Never pick an option marked feasible: false.

Reply with ONE JSON object and nothing else, in the shape that matches your option:
{"assign": "<task_id>", "to": "<robot_id>", "reason": "..."}
{"handoff": "<task_id>", "to": "<robot_id>", "preempt": "<task_id or null>", "reason": "..."}
{"charge_then_continue": "<task_id>", "reason": "..."}
{"continue": "<task_id>", "reason": "..."}
{"wait": "<task_id>", "reason": "..."}
The reason is at most 12 words, for the operations log.`;

export function brainQuestion(event: FleetEvent, taskId: string, options: Option[], s: FleetSnapshot): string {
  const fleet = {
    robots: s.robots.map((r) => ({ id: r.id, phase: r.phase, battery: Math.round(r.battery), fault: r.fault, task: r.taskId })),
    tasks: s.tasks
      .filter((t) => t.status !== 'delivered' && t.status !== 'cancelled')
      .map((t) => ({ id: t.id, kind: t.kind, priority: t.priority, room: t.room, item: t.item, status: t.status, robot: t.robotId })),
  };
  return JSON.stringify({ event, task: taskId, fleet, options });
}
