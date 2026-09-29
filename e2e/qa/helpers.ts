import { expect, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConversationDetailDTO, MessageDTO, TenantDTO } from '../../src/shared/api.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const T = {
  oficina: 'oficina-vila-mariana',
  salao: 'salao-pinheiros',
  odonto: 'odonto-moema',
  pet: 'pet-perdizes',
  estetica: 'estetica-itaim',
} as const;

let seq = 0;
export function phone(): string {
  seq++;
  return `+55 11 96${String(Date.now() % 100000).padStart(5, '0')}-${String(seq).padStart(4, '0')}`;
}

export function db(): DatabaseSync {
  return new DatabaseSync(path.join(ROOT, 'data/qa.db'), { readOnly: true });
}

export function q<T = Record<string, unknown>>(sql: string, ...params: (string | number)[]): T[] {
  const d = db();
  try {
    return d.prepare(sql).all(...params) as T[];
  } finally {
    d.close();
  }
}

export interface Turn {
  message: MessageDTO;
  reply: MessageDTO | null;
  turn: { escalated: boolean; guard: boolean; tools: string[]; skipped?: string };
}

export async function send(api: APIRequestContext, tenantId: string, ph: string, text: string, name = 'QA Tester'): Promise<Turn> {
  const res = await api.post('/api/sim/messages?wait=1', { data: { tenantId, phone: ph, name, type: 'text', text }, timeout: 240_000 });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as Turn;
}

export async function detail(api: APIRequestContext, convId: number): Promise<ConversationDetailDTO> {
  const res = await api.get(`/api/conversations/${convId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ConversationDetailDTO;
}

export async function tenants(api: APIRequestContext): Promise<TenantDTO[]> {
  return (await (await api.get('/api/tenants')).json()) as TenantDTO[];
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Plays a cooperative customer until `done()` is true: picks the first offered time, answers
 * questions about name, car, pet, insurance, confirms when asked. Returns the transcript.
 */
export async function converse(
  api: APIRequestContext,
  tenantId: string,
  ph: string,
  opening: string,
  done: (convId: number) => Promise<boolean>,
  maxTurns = 7,
): Promise<{ convId: number; transcript: string[]; turns: Turn[] }> {
  const transcript: string[] = [];
  const turns: Turn[] = [];
  let text = opening;
  let convId = 0;
  for (let i = 0; i < maxTurns; i++) {
    const t = await send(api, tenantId, ph, text);
    turns.push(t);
    convId = t.message.conversationId;
    transcript.push(`C: ${text}`, `B: ${t.reply?.text ?? '(no reply)'}`);
    if (await done(convId)) break;
    const r = norm(t.reply?.text ?? '');
    const time = r.match(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?)\b/);
    if (/confirm|posso (agendar|remarcar|cancelar)|pode ser\?|fechado\?|combinado\?/.test(r) && !/qual/.test(r)) text = 'sim, pode';
    else if (/placa|modelo|ano do carro|seu carro/.test(r)) text = 'onix 2019, placa QAT1A23';
    else if (/porte|nome do (seu )?pet|nome dele|nome dela/.test(r)) text = 'o nome dele e Thor, porte medio';
    else if (/convenio|particular/.test(r)) text = 'particular';
    else if (/seu nome|nome completo|como (voce )?se chama/.test(r)) text = 'meu nome e QA Tester';
    else if (time) text = `pode ser ${time[0]}`;
    else if (/profissional|preferencia/.test(r)) text = 'qualquer profissional';
    else text = 'pode ser amanha de manha, qualquer horario';
  }
  return { convId, transcript, turns };
}
