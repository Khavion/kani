import path from 'node:path';
import { ROOT } from '../src/config.ts';
import { createKani, type Kani } from '../src/app.ts';
import type { ChatRequest, ChatResponse, LLM, ToolCall } from '../src/engine/llm.ts';
import { Clock, fromLocal } from '../src/util/time.ts';

export type Script = (req: ChatRequest, callIndex: number) => Partial<ChatResponse> & { toolCalls?: ToolCall[] };

/** Deterministic LLM double: answers from a script function and records every request. */
export class ScriptedLLM implements LLM {
  readonly requests: ChatRequest[] = [];
  private readonly script: Script;
  private readonly tools: boolean;

  constructor(script: Script, opts: { tools?: boolean } = {}) {
    this.script = script;
    this.tools = opts.tools ?? true;
  }

  async supportsTools(): Promise<boolean> {
    return this.tools;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const i = this.requests.length;
    this.requests.push(structuredClone(req));
    const r = this.script(req, i);
    return { content: r.content ?? '', toolCalls: r.toolCalls ?? [], evalCount: 0, promptEvalCount: 0, durationMs: 1 };
  }
}

export const reply = (content: string): Script => () => ({ content });

/** A Tuesday 10:00 in Sao Paulo, well inside every demo tenant's opening hours. */
export const TUESDAY_10 = fromLocal(2026, 10, 6, 10, 0);

export function testKani(llm: LLM, opts: { at?: Date; seed?: 'tenants' | 'demo' } = {}): Kani {
  const clock = new Clock();
  clock.freeze(opts.at ?? TUESDAY_10);
  return createKani({
    cfg: { dbPath: ':memory:', mediaDir: path.join(ROOT, '.local/test-media') },
    seed: opts.seed ?? 'tenants',
    clock,
    llm,
    media: null,
    memorySummaries: false,
  });
}

export const OFICINA = 'oficina-vila-mariana';
export const SALAO = 'salao-pinheiros';
export const ODONTO = 'odonto-moema';

export async function say(k: Kani, tenantId: string, text: string, phone = '+55 11 90000-1111', name = 'Cliente Teste') {
  const res = await k.engine.handleInbound({ tenantId, phone, name, type: 'text', text });
  const turn = await res.done;
  return { res, turn };
}
