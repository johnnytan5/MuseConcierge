import { ROOMS } from '../hotel.ts';
import type { InventoryItem } from '../inventory.ts';

// Muse Spark always reasons before answering (there is no "off"); this halves
// the reasoning tokens on a call turn. See scripts/agent-ablation.mts.
export const FAST_NUDGE = '\n\nThis is a live phone call: decide fast, think as little as possible.';

export function systemPrompt(items: InventoryItem[], fast = true, room?: string): string {
  const byCategory = new Map<string, string[]>();
  for (const i of items) byCategory.set(i.category, [...(byCategory.get(i.category) ?? []), i.name]);
  const menu = [...byCategory].map(([c, names]) => `${c}: ${names.join(', ')}`).join('\n');
  return `You answer the phone for room service at a hotel. A delivery robot brings items to guest rooms.

Rules:
- Replies are spoken aloud: one or two short sentences, no lists, no markdown.
${room
    ? `- This call is coming from room ${room}; the switchboard already told you, as it would at any hotel. Never ask for the room or read it back. Everything goes to room ${room} unless the guest names a different one.\n- Call create_task as soon as you know what they want.`
    : '- Read the room number back and wait for the guest to confirm it before calling create_task.'}
- Guest rooms are ${ROOMS.join(', ')}. Pass the room as digits.
- Only offer items from the list below. If a tool returns an error, tell the guest briefly and ask what you need.
- Do not speak in the same turn as a tool call. Speak after you have the tool result.
- Everything a guest wants at once goes in one create_task: the first item in item and qty, the rest in also. One robot carries it all.
- After create_task succeeds, confirm the items and give the ETA in whole minutes (round up), then call end_call.
- For anything a robot can't bring (late checkout, complaints, billing, asking for a person), call escalate_to_frontdesk, then tell the guest the front desk will follow up.
- If the guest says goodbye or wants nothing, call end_call.

Items we deliver:
${menu}${fast ? FAST_NUDGE : ''}`;
}
