// LLM client for Ollama with a single in-flight generation queue.
// Every call to the model (bot, customer simulator, judge, vision, memory) goes through
// GenerationQueue so only one request hits Ollama at a time.

import { stripThink } from '../util/text.ts';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema object
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[]; // base64 (vision)
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  format?: 'json' | Record<string, unknown>;
  temperature?: number;
  numPredict?: number;
  numCtx?: number;
  timeoutMs?: number;
  label?: string; // for logs/metrics
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  evalCount: number;
  promptEvalCount: number;
  durationMs: number;
}

export interface LLM {
  chat(req: ChatRequest): Promise<ChatResponse>;
  supportsTools(model: string): Promise<boolean>;
}

export class LLMTimeoutError extends Error {
  constructor(ms: number) {
    super(`LLM generation timed out after ${ms}ms`);
  }
}

/** FIFO queue that runs one async job at a time. */
export class GenerationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  get depth(): number {
    return this.pending;
  }

  run<T>(job: () => Promise<T>): Promise<T> {
    this.pending++;
    const result = this.tail.then(job, job);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.pending--;
    });
  }
}

export const globalQueue = new GenerationQueue();

export class OllamaClient implements LLM {
  private readonly url: string;
  private readonly queue: GenerationQueue;
  private readonly defaultTimeoutMs: number;
  private capsCache = new Map<string, string[]>();

  constructor(url: string, opts: { queue?: GenerationQueue; timeoutMs?: number } = {}) {
    this.url = url.replace(/\/$/, '');
    this.queue = opts.queue ?? globalQueue;
    this.defaultTimeoutMs = opts.timeoutMs ?? 60_000;
  }

  async capabilities(model: string): Promise<string[]> {
    const cached = this.capsCache.get(model);
    if (cached) return cached;
    try {
      const res = await fetch(`${this.url}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) return [];
      const j = (await res.json()) as { capabilities?: string[] };
      const caps = j.capabilities ?? [];
      this.capsCache.set(model, caps);
      return caps;
    } catch {
      return [];
    }
  }

  async supportsTools(model: string): Promise<boolean> {
    return (await this.capabilities(model)).includes('tools');
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.url}/api/tags`);
    if (!res.ok) throw new Error(`ollama /api/tags ${res.status}`);
    const j = (await res.json()) as { models: { name: string }[] };
    return j.models.map((m) => m.name);
  }

  chat(req: ChatRequest): Promise<ChatResponse> {
    return this.queue.run(() => this.chatNow(req));
  }

  private async chatNow(req: ChatRequest): Promise<ChatResponse> {
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const started = Date.now();
    const caps = await this.capabilities(req.model);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: false,
      keep_alive: '30m',
      options: {
        temperature: req.temperature ?? 0.4,
        num_predict: req.numPredict ?? 400,
        num_ctx: req.numCtx ?? 8192,
      },
    };
    if (caps.includes('thinking')) body.think = false;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (req.format) body.format = req.format;
    try {
      const res = await fetch(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ollama /api/chat ${res.status}: ${text.slice(0, 300)}`);
      }
      const j = (await res.json()) as {
        message: {
          content?: string;
          tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[];
        };
        eval_count?: number;
        prompt_eval_count?: number;
      };
      const toolCalls: ToolCall[] = (j.message.tool_calls ?? []).map((tc) => ({
        name: tc.function.name,
        arguments:
          typeof tc.function.arguments === 'string'
            ? (safeParse(tc.function.arguments) ?? {})
            : (tc.function.arguments ?? {}),
      }));
      return {
        content: stripThink(j.message.content ?? ''),
        toolCalls,
        evalCount: j.eval_count ?? 0,
        promptEvalCount: j.prompt_eval_count ?? 0,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new LLMTimeoutError(timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Extract a prompted tool call from plain text. Used for models without native tool support
 * (e.g. gemma3) and as a fallback when a native-tools model writes the call as text.
 * Accepts {"tool": "...", "args": {...}}, {"name": "...", "arguments": {...}} and <tool_call> wrappers.
 */
export function parseTextToolCalls(text: string, known: Set<string>): { calls: ToolCall[]; rest: string } {
  const calls: ToolCall[] = [];
  let rest = text;
  const candidates: string[] = [];
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) candidates.push(m[1]);
  for (const m of text.matchAll(/```(?:json|tool_code|tool)?\s*([\s\S]*?)```/g)) candidates.push(m[1]);
  // Bare JSON objects that mention a tool key
  for (const obj of scanJsonObjects(text)) candidates.push(obj);
  const seen = new Set<string>();
  for (const c of candidates) {
    const parsed = safeParse(c.trim());
    if (!parsed) continue;
    const name = (parsed.tool ?? parsed.name ?? parsed.function) as string | undefined;
    const args = (parsed.args ?? parsed.arguments ?? parsed.parameters ?? {}) as Record<string, unknown>;
    if (typeof name === 'string' && known.has(name)) {
      const key = name + JSON.stringify(args);
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({ name, arguments: typeof args === 'object' && args ? args : {} });
      rest = rest.replace(c, '');
    }
  }
  if (calls.length) {
    rest = rest
      .replace(/<\/?tool_call>/g, '')
      .replace(/```(?:json|tool_code|tool)?\s*```/g, '')
      .trim();
  }
  return { calls, rest };
}

function scanJsonObjects(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') j++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const chunk = text.slice(i, j + 1);
          if (/"(tool|name|function)"\s*:/.test(chunk)) out.push(chunk);
          i = j;
          break;
        }
      }
    }
  }
  return out;
}
