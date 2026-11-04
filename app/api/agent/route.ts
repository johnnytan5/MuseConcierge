// Stateless Muse Spark proxy for one call turn. The browser keeps the
// conversation and runs the tools; this route only adds the system prompt
// and keeps the Meta key server-side.
import { chat, MODELS, type ChatMessage } from '@/lib/meta/client.ts';
import { TOOL_DEFS } from '@/lib/agent/tools.ts';
import { systemPrompt } from '@/lib/agent/prompt.ts';
import { ROOMS } from '@/lib/hotel.ts';
import { loadInventory, deliverable } from '@/lib/inventory.ts';
import { callIsRecent, LIMITS } from '@/lib/limits.ts';

const MAX_MESSAGES = 60; // a short room-service call; caps cost per request

export async function POST(req: Request) {
  const { messages, callId, room } = (await req.json()) as { messages: ChatMessage[]; callId?: string; room?: string };
  if (!(await callIsRecent(callId, LIMITS.callMinutes))) return Response.json({ error: 'call expired' }, { status: 403 });
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES || messages.some((m) => m.role === 'system')) {
    return Response.json({ error: 'bad messages' }, { status: 400 });
  }
  const t0 = Date.now();
  try {
    const items = deliverable(await loadInventory());
    const message = await chat({
      model: MODELS.spark,
      messages: [{ role: 'system', content: systemPrompt(items, true, room && ROOMS.includes(room) ? room : undefined) }, ...messages],
      tools: TOOL_DEFS,
      maxTokens: 1000,
      reasoningEffort: 'minimal',
    });
    return Response.json({ message, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 200) : 'agent failed' }, { status: 502 });
  }
}
