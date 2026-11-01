// Meta Model API in OpenAI chat-completions format. Server-side only: it
// reads META_API_KEY, which must never reach a client bundle.

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type AssistantMessage = { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] };

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | AssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const MODELS = {
  // 1.1 answers a call turn in ~0.9 s vs ~1.7 s for 1.3, equally correct on
  // the call script (scripts/agent-ablation.mts, 2026-10-30).
  spark: process.env.SPARK_MODEL ?? 'muse-spark-1.1',
  wonder: process.env.WONDER_MODEL ?? 'muse-wonder-1.0',
  // Set BRAIN_MODEL=muse-spark-1.3 while testing to save credits for the recording.
  brain: process.env.BRAIN_MODEL ?? 'muse-wonder-1.0',
  sam: process.env.SAM_MODEL ?? 'sam-3.1',
};

const BASE_URL = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';

export async function chat(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  // Muse models reason before answering and the reasoning counts against
  // maxTokens; 'minimal' keeps a voice turn near 2 s instead of 4 s.
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  timeoutMs?: number;
}): Promise<AssistantMessage> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.META_API_KEY}` },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`meta ${res.status}: ${body.slice(0, 200)}`);
  const choice = JSON.parse(body).choices[0];
  if (!choice.message.content && !choice.message.tool_calls?.length) {
    throw new Error(`meta returned an empty message (finish_reason ${choice.finish_reason})`);
  }
  return choice.message;
}

// SAM 3.1 on the Responses endpoint: a text prompt plus an image, answered
// with <|box;...|> markers in the output text (parsed by lib/vision).
export async function segment(prompt: string, imageDataUrl: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(`${BASE_URL}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.META_API_KEY}` },
    body: JSON.stringify({
      model: MODELS.sam,
      stream: false,
      metadata: { include_confidence: 'true' },
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageDataUrl }] }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`sam ${res.status}: ${body.slice(0, 200)}`);
  const j = JSON.parse(body);
  return j.output_text ?? (j.output ?? []).flatMap((o: { content?: { text?: string }[] }) => o.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
}
