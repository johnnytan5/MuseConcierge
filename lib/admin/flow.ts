// One call summed up for its flow graph: who took part, what got done, how it
// ended. Reads only the call's tool rows, old Concierge calls included.
type Row = { tool_name: string; arguments?: unknown; result?: unknown; result_summary?: string | null };

export const TOOL_LABEL: Record<string, string> = {
  check_menu: 'Looked up the menu', dispatch_delivery: 'Placed an order', create_task: 'Placed an order', amend_delivery: 'Changed an order',
  recall_robot: 'Recalled a robot', cancel_task: 'Cancelled an order', deliver_parcel: 'Sent up a parcel', hotel_info: 'Answered a question',
  check_delivery_status: 'Checked a delivery', get_task_status: 'Checked a delivery', get_fleet_state: 'Checked the fleet', announce_arrival: 'Announced arrival',
  escalate_to_frontdesk: 'Escalated to front desk', end_call: 'Ended the call',
  brain_decision: 'Brain decision', bin_loaded: 'Bin loaded', door_check: 'Room number check', cabin_check: 'Cabin check', collection: 'Guest collected',
};
export const toolLabel = (t: string) => TOOL_LABEL[t] ?? t.replace(/_/g, ' ');

const GROUPS: { key: string; label: string; tools: string[] }[] = [
  { key: 'order', label: 'Order handling', tools: ['create_task', 'dispatch_delivery', 'amend_delivery', 'recall_robot', 'cancel_task', 'get_task_status', 'check_delivery_status'] },
  { key: 'parcel', label: 'Food delivery', tools: ['deliver_parcel'] },
  { key: 'menu', label: 'Menu lookup', tools: ['check_menu'] },
  { key: 'info', label: 'General inquiry', tools: ['hotel_info'] },
  { key: 'brain', label: 'Fleet planning', tools: ['brain_decision'] },
  { key: 'handover', label: 'Hand-overs', tools: ['bin_loaded', 'collection'] },
  { key: 'vision', label: 'Delivery checks', tools: ['door_check', 'cabin_check'] },
  { key: 'escalate', label: 'Escalated to desk', tools: ['escalate_to_frontdesk'] },
];

export type FlowNode = { label: string; count: number; alert?: boolean };

export function flowActions(rows: Row[]): FlowNode[] {
  return GROUPS.map((g) => ({
    label: g.label,
    count: rows.filter((r) => g.tools.includes(r.tool_name)).length,
    alert: g.key === 'escalate',
  }));
}

const has = (rows: Row[], t: string) => rows.some((r) => r.tool_name === t);
const taskOf = (r: Row) => (r.result as { task_id?: unknown } | null)?.task_id;

export function flowOutcomes(rows: Row[]): FlowNode[] {
  const out: FlowNode[] = [];
  const orders = rows.filter((r) => ['create_task', 'dispatch_delivery', 'deliver_parcel'].includes(r.tool_name) && taskOf(r));
  if (orders.length) out.push({ label: orders.length > 1 ? `${orders.length} orders placed` : 'Order placed', count: 0 });
  if (rows.some((r) => r.tool_name === 'brain_decision' && (r.result as { handoff?: unknown } | null)?.handoff)) out.push({ label: 'Handed to another robot', count: 0 });
  const door = rows.find((r) => r.tool_name === 'door_check');
  if (door?.result_summary) out.push({ label: /right|confirmed/i.test(door.result_summary) ? 'Right door confirmed' : 'Door not confirmed', count: 0 });
  if (has(rows, 'collection')) out.push({ label: 'Collected by the guest', count: 0 });
  if (has(rows, 'hotel_info')) out.push({ label: 'Question answered', count: 0 });
  if (has(rows, 'escalate_to_frontdesk')) out.push({ label: 'Front desk following up', count: 0, alert: true });
  return out;
}

// A tool's arguments as short key/value lines; nested detail stays out of the
// way (a brain decision's full options aren't for reading here).
export function argLines(args: unknown): { k: string; v: string }[] {
  if (!args || typeof args !== 'object') return [];
  const lines: { k: string; v: string }[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'object') lines.push({ k, v: String(v) });
    else if (Array.isArray(v)) {
      const parts = v.map((x) => (typeof x === 'object' && x && 'item' in x ? `${(x as { qty?: number }).qty ?? 1}× ${(x as { item: string }).item}` : typeof x === 'object' ? null : String(x)));
      if (parts.every(Boolean)) lines.push({ k, v: parts.join(', ') });
    }
  }
  return lines;
}

// How long after the guest's last line this happened; nothing before they speak.
export function replyMs(at: number, guestTimes: number[]): number | null {
  const before = guestTimes.filter((t) => t <= at);
  return before.length ? at - Math.max(...before) : null;
}
