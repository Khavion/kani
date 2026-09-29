// Scenario runner: plays each scenario against the real engine with a simulated customer (same local
// model by default), then scores it with deterministic checks + an LLM judge.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import { createKani, type Kani } from '../app.ts';
import type { Message, Tenant } from '../db/repo.ts';
import { getPack, type Pack } from '../packs/packs.ts';
import type { ChatMessage, LLM } from '../engine/llm.ts';
import type { TurnResult } from '../engine/engine.ts';
import { addDays, addMinutes, formatHoursPt, fromLocal, toLocal, Clock } from '../util/time.ts';
import { formatBRL, norm, stripThink } from '../util/text.ts';
import { loadScenarioFiles, AXES, AXIS_KEYS, type JudgeResult, type RunSummary, type Scenario, type ScenarioRecord, type TranscriptEntry } from './types.ts';
import { p95, scoreScenario, type Evidence } from './scorer.ts';

export interface RunOptions {
  model: string;
  judgeModel?: string;
  customerModel?: string;
  packs?: string[];
  ids?: string[];
  liveVision?: boolean;
  maxTurns?: number;
  dbPath?: string;
  llm?: LLM; // tests inject a fake
  log?: (line: string) => void;
}

// Gender-neutral WhatsApp profile nicknames so the name never contradicts the scenario persona.
const CUSTOMER_NAMES = ['Alex Souza', 'Dani Costa', 'Rafa Lima', 'Sam Oliveira', 'Ariel Santos', 'Jo Almeida', 'Kim Rocha', 'Nic Pereira'];

/** Next Tuesday (at least 1 day ahead) at HH:MM Sao Paulo time. Tuesday is open for every demo tenant. */
export function scenarioBaseTime(hhmm = '10:00', from = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number);
  for (let i = 1; i <= 8; i++) {
    const p = toLocal(addDays(from, i));
    if (p.weekday === 'ter') return fromLocal(p.year, p.month, p.day, h || 0, m || 0);
  }
  return from;
}

function parseSetup(setup: string, base: Date): { at: Date; status: 'booked' | 'no_show' | 'done' } {
  const t = norm(setup);
  const dayShift = /ontem/.test(t) ? -1 : /hoje/.test(t) ? 0 : 1;
  const hm = t.match(/(\d{1,2})h/);
  const status = /no_show/.test(t) ? 'no_show' : /\bdone\b/.test(t) ? 'done' : 'booked';
  const hour = hm ? Number(hm[1]) : status === 'done' ? 8 : 10;
  const p = toLocal(addDays(base, dayShift));
  return { at: fromLocal(p.year, p.month, p.day, hour, 0), status };
}

function transcriptOf(repo: Kani['repo'], convId: number): TranscriptEntry[] {
  return repo.listMessages(convId).map((m) => entryOf(m));
}

function entryOf(m: Message): TranscriptEntry {
  let text = m.text ?? '';
  if (m.type === 'audio') text = `[audio] ${m.transcript ?? ''}`;
  if (m.type === 'image') text = `[foto: ${(m.meta.imageDescription as string) ?? '...'}]${m.text ? ' ' + m.text : ''}`;
  return {
    role: m.role,
    text,
    type: m.type,
    tools: (m.meta.tools as string[] | undefined) ?? [],
    latencyMs: m.latencyMs,
    guard: !!m.meta.guard,
    rawText: m.meta.rawText as string | undefined,
    kind: m.meta.kind as string | undefined,
  };
}

// ------------------------------------------------------------------------------------------------ customer simulator

export function customerSystemPrompt(s: Scenario, tenant: Tenant, pack: Pack): string {
  return (
    `Voce e ${s.persona}. Objetivo: ${s.title}. Escreva como paulistano no WhatsApp: abreviacoes, sem formalidade. Uma mensagem por vez. Encerre quando resolvido ou frustrado.\n` +
    `Contexto: voce esta conversando pelo WhatsApp com ${tenant.name} (${pack.name}). Voce e o CLIENTE, nunca o atendente. ` +
    'Escreva apenas a sua proxima mensagem (curta, ate 30 palavras), sem aspas, sem narrar e sem explicar. ' +
    'Seja coerente com o que voce ja disse: se escolheu um horario, confirme esse mesmo horario. ' +
    'Se pedirem seus dados (nome, modelo e placa do carro, nome e porte do pet, convenio, etc.), invente dados plausiveis. ' +
    'Quando o objetivo estiver resolvido, ou se voce desistir, responda apenas [FIM].'
  );
}

async function simulateCustomer(llm: LLM, model: string, s: Scenario, tenant: Tenant, pack: Pack, history: Message[]): Promise<string | null> {
  const msgs: ChatMessage[] = [{ role: 'system', content: customerSystemPrompt(s, tenant, pack) }];
  const turns: ChatMessage[] = [{ role: 'user', content: '(Voce abre o WhatsApp da loja para conversar.)' }];
  for (const m of history) {
    const role = m.role === 'customer' ? 'assistant' : 'user';
    const content = entryOf(m).text;
    const last = turns[turns.length - 1];
    if (last.role === role) last.content += `\n${content}`;
    else turns.push({ role, content });
  }
  if (turns[turns.length - 1].role === 'assistant') return null; // nothing new from the business
  const res = await llm.chat({ model, messages: [...msgs, ...turns], temperature: 0.8, numPredict: 90, label: 'customer' });
  let text = stripThink(res.content).trim();
  text = text.replace(/^(cliente|voce|eu)\s*:\s*/i, '').replace(/^["']|["']$/g, '').trim();
  // End markers: [FIM], a bare FIM, or any invented bracket token at the start ("[OK] ...").
  if (!text || /\[\s*fim\s*\]/i.test(text) || /^\s*\(?fim\)?[.!]?\s*$/i.test(text) || /^\s*\[[A-Z_ ]{2,12}\]/.test(text)) return null;
  return text.slice(0, 400);
}

// ------------------------------------------------------------------------------------------------ judge

const judgeFormat = {
  type: 'object',
  properties: Object.fromEntries(
    AXIS_KEYS.map((k) => [k, { type: 'object', properties: { score: { type: 'integer' }, why: { type: 'string' } }, required: ['score', 'why'] }]),
  ),
  required: AXIS_KEYS,
};

export function judgePrompt(s: Scenario, tenant: Tenant, pack: Pack, transcript: TranscriptEntry[], toolLog: string[]): string {
  const facts = [
    `Business: ${tenant.name} (${pack.name}). Hours: ${formatHoursPt(tenant.hours)}. Pix key: ${tenant.pixKey}. Google review link: ${tenant.googleReviewLink}.`,
    `Price list (the ONLY valid prices): ${tenant.services.map((x) => `${x.n} = ${x.p > 0 ? formatBRL(x.p) : 'sem custo'}`).join('; ')}.`,
    `Pack rules: forbidden = ${pack.forbidden.join('; ')}. Escalate when: ${pack.escalation_triggers.join('; ')}.`,
  ].join('\n');
  const convo = transcript
    .map((t) => `[${t.role === 'customer' ? 'CUSTOMER' : t.role === 'owner' ? 'OWNER' : 'ASSISTANT'}]${t.tools?.length ? ` (tools: ${t.tools.join(', ')})` : ''} ${t.text}`)
    .join('\n');
  const rubric = AXIS_KEYS.map((k) => `- ${k} (0-${AXES[k].max})`).join('\n');
  return [
    'You are a strict QA judge for a Brazilian WhatsApp assistant for small businesses. Score the ASSISTANT only.',
    facts,
    `Scenario ${s.id}: customer persona "${s.persona}". Customer goal: "${s.title}". Expected assistant behavior: "${s.expect}".`,
    `Tool calls executed (name:ok): ${toolLog.join(', ') || 'none'}. IMPORTANT: an appointment only exists if book/reschedule/cancel appears here with ok. If the assistant told the customer something was booked, rescheduled or cancelled without the matching ok tool call, action_correctness must be 0 and factual_grounding at most 1.`,
    'Transcript:',
    convo,
    'Rubric (integers):',
    rubric,
    'Definitions: factual_grounding = every price/hour/service/fact matches the business data, nothing invented (3 perfect, 0 invented or wrong facts). ' +
      'action_correctness = the assistant took the right actions for the goal (checked availability, booked, rescheduled, cancelled, quoted, or correctly did nothing), confirmed only what the tools did (3 perfect). ' +
      'escalation_judgment = handed off to a human when needed (complaints, clinical/technical out-of-scope, prices off the list, request for human) and not otherwise (2 perfect). ' +
      'portuguese_quality = natural, correct, concise Brazilian Portuguese, one consolidated message per turn (2 perfect). ' +
      'tone = warm, professional, fits the business, calm under rudeness, no pressure (2 perfect). ' +
      "grievance_mitigated = the customer's need or complaint was resolved, de-escalated or correctly routed (3 perfect, 0 made it worse or ignored it).",
    'Return JSON only: for each axis an object {"score": int, "why": "one short English sentence"}.',
  ].join('\n\n');
}

async function judgeScenario(llm: LLM, model: string, prompt: string): Promise<JudgeResult> {
  const res = await llm.chat({
    model,
    messages: [{ role: 'user', content: prompt }],
    format: judgeFormat,
    temperature: 0,
    numPredict: 700,
    timeoutMs: 120_000,
    label: 'judge',
  });
  const j = JSON.parse(stripThink(res.content)) as JudgeResult;
  for (const k of AXIS_KEYS) {
    if (!j[k] || typeof j[k].score !== 'number') throw new Error(`judge missing axis ${k}`);
  }
  return j;
}

// ------------------------------------------------------------------------------------------------ one scenario

async function runOne(k: Kani, opts: RunOptions, tenant: Tenant, s: Scenario, index: number): Promise<ScenarioRecord> {
  const started = Date.now();
  const pack = getPack(tenant.packId);
  const clock = k.clock;
  const base = scenarioBaseTime(s.clock ?? '10:00');
  clock.freeze(base);
  const phone = `+55 11 97${String(index).padStart(3, '0')}-${String(1000 + Math.floor(Math.random() * 8999))}`;
  const name = CUSTOMER_NAMES[index % CUSTOMER_NAMES.length];
  const contact = k.repo.upsertContact(tenant.id, phone, name);
  let conv = k.repo.getOrCreateConversation(tenant.id, contact.id);
  const turns: TurnResult[] = [];
  const latencies: number[] = [];
  let endedBy = 'max_turns';
  const maxTurns = Math.min(opts.maxTurns ?? s.max_turns, s.max_turns);
  const customerModel = opts.customerModel ?? opts.model;

  // Setup
  let setupAppt = null;
  if (s.setup) {
    const svc =
      tenant.services.find((x) => norm(x.n) === norm(s.setup_service ?? '')) ?? tenant.services.find((x) => x.p > 0 && x.min > 0)!;
    const { at, status } = parseSetup(s.setup, base);
    setupAppt = k.repo.insertAppointment({
      tenantId: tenant.id,
      contactId: contact.id,
      service: svc.n,
      staff: tenant.staff[0]?.name ?? null,
      startsAt: at.toISOString(),
      endsAt: addMinutes(at, Math.max(svc.min, pack.booking_rules.slot_min)).toISOString(),
      status,
      price: svc.p,
      source: 'setup',
      conversationId: conv.id,
      createdAt: addDays(base, -7).toISOString(),
    });
  }
  // Proactive trigger from the business before the customer speaks
  if (s.trigger === 'no_show_recovery' && setupAppt) {
    const rem = k.repo.insertReminder({ appointmentId: setupAppt.id, tenantId: tenant.id, contactId: contact.id, fireAt: clock.nowIso(), kind: 'reactivation' });
    await k.engine.sendReminder(rem);
  } else if (s.trigger === 'review_request' && setupAppt) {
    await k.engine.sendReviewRequest(setupAppt);
  }

  type Input = { type: 'text' | 'audio' | 'image'; text?: string; simulatedTranscript?: string; imageDescription?: string; mediaPath?: string };
  const queue: Input[] = [];
  const openings = [...s.opening];
  if (s.audio) {
    const transcript = s.audio.replace(/^\s*transcript\s*:\s*/i, '').replace(/^['"]|['"]$/g, '').trim();
    queue.push({ type: 'audio', simulatedTranscript: transcript });
  }
  if (s.image_description) {
    const caption = openings.shift();
    const input: Input = { type: 'image', text: caption };
    const fixture = s.image_fixture ? path.join(ROOT, s.image_fixture) : null;
    if (opts.liveVision && fixture && existsSync(fixture)) {
      const file = `scenario-${tenant.packId}-${s.id}-${Date.now()}${path.extname(fixture)}`;
      copyFileSync(fixture, path.join(k.cfg.mediaDir, file));
      input.mediaPath = file;
    } else {
      input.imageDescription = s.image_description;
    }
    queue.push(input);
  }
  for (const o of openings) queue.push({ type: 'text', text: o });

  let error: string | undefined;
  try {
    let customerTurns = 0;
    let lastCustomer = '';
    while (customerTurns < maxTurns) {
      let input = queue.shift();
      if (!input) {
        const text = await simulateCustomer(k.llm, customerModel, s, tenant, pack, k.repo.listMessages(conv.id));
        if (!text) {
          endedBy = 'customer_done';
          break;
        }
        if (norm(text) === norm(lastCustomer)) {
          endedBy = 'customer_repeating';
          break;
        }
        input = { type: 'text', text };
      }
      lastCustomer = input.text ?? input.simulatedTranscript ?? '';
      const res = await k.engine.handleInbound({
        tenantId: tenant.id,
        phone,
        name,
        type: input.type,
        text: input.text ?? null,
        mediaPath: input.mediaPath ?? null,
        simulatedTranscript: input.simulatedTranscript,
        imageDescription: input.imageDescription,
      });
      const turn = await res.done;
      turns.push(turn);
      if (turn.latencyMs !== null && turn.reply) latencies.push(turn.latencyMs);
      customerTurns++;
      conv = k.repo.getConversation(turn.conversationId) ?? conv;
      if (conv.status === 'human') {
        endedBy = 'handed_to_human';
        break;
      }
      if (conv.status === 'closed') {
        endedBy = 'closed';
        break;
      }
    }
  } catch (err) {
    error = (err as Error).message;
    endedBy = 'error';
  }

  const messages = k.repo.listMessages(conv.id);
  const transcript = transcriptOf(k.repo, conv.id);
  const toolCalls = turns.flatMap((t) => t.toolCalls.map((c) => ({ name: c.name, ok: !!c.result.ok, args: c.args })));
  const assistantMsgs = messages.filter((m) => m.role === 'assistant');
  const booked = k.repo
    .appointmentsForContact(contact.id)
    .some((a) => a.source === 'bot' && (a.status === 'booked' || a.status === 'confirmed'));
  const ev: Evidence = {
    botTexts: assistantMsgs.map((m) => m.text ?? ''),
    rawBotTexts: assistantMsgs.map((m) => (m.meta.rawText as string | undefined) ?? m.text ?? ''),
    toolCalls,
    booked,
    escalated: k.repo.escalationsForConversation(conv.id).length > 0,
    guardTriggers: assistantMsgs.filter((m) => m.meta.guard).length,
    unbackedClaims:
      k.repo.events({ kind: 'claim_repair', conversationId: conv.id }).length +
      k.repo.events({ kind: 'book_converted', conversationId: conv.id }).length,
    services: tenant.services,
    quoteTotals: k.repo.quotesForConversation(conv.id).map((q) => q.total),
    pixKey: tenant.pixKey,
    ignoreStrings: [tenant.address, tenant.phone, tenant.pixKey, tenant.googleReviewLink, phone],
    latenciesMs: latencies,
  };

  let judge: JudgeResult | null = null;
  let judgeError: string | undefined;
  try {
    judge = await judgeScenario(
      k.llm,
      opts.judgeModel ?? opts.model,
      judgePrompt(s, tenant, pack, transcript, toolCalls.map((t) => `${t.name}:${t.ok ? 'ok' : 'fail'}`)),
    );
  } catch (err) {
    judgeError = (err as Error).message;
  }
  const scored = scoreScenario(s, ev, judge);
  return {
    pack: tenant.packId,
    tenantId: tenant.id,
    tenantName: tenant.name,
    scenario: s,
    transcript,
    toolCalls,
    checks: scored.checks,
    axes: scored.axes,
    judge,
    judgeError,
    score: scored.score,
    latency: scored.latency,
    passed: scored.passed && !error,
    endedBy,
    durationMs: Date.now() - started,
    guardTriggers: ev.guardTriggers,
    escalated: ev.escalated,
    error,
  };
}

// ------------------------------------------------------------------------------------------------ run all

export async function runScenarios(opts: RunOptions): Promise<RunSummary> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[-:]/g, '').replace(/\..+/, '');
  const tmp = path.join(ROOT, 'reports/tmp');
  mkdirSync(tmp, { recursive: true });
  const clock = new Clock();
  const k = createKani({
    cfg: {
      dbPath: opts.dbPath ?? path.join(tmp, `run-${stamp}-${opts.model.replace(/\W/g, '_')}.db`),
      mediaDir: path.join(tmp, 'media'),
    },
    seed: 'tenants',
    clock,
    model: opts.model,
    memorySummaries: false,
    ...(opts.llm ? { llm: opts.llm } : {}),
  });
  const files = loadScenarioFiles().filter((f) => !opts.packs?.length || opts.packs.includes(f.pack));
  const records: ScenarioRecord[] = [];
  let index = 0;
  for (const file of files) {
    const tenant = k.repo.listTenants().find((t) => t.packId === file.pack);
    if (!tenant) {
      log(`[skip] no tenant for pack ${file.pack}`);
      continue;
    }
    for (const s of file.scenarios) {
      if (opts.ids?.length && !opts.ids.includes(s.id)) continue;
      index++;
      const rec = await runOne(k, opts, tenant, s, index);
      records.push(rec);
      const failed = rec.checks.filter((c) => !c.pass).map((c) => c.name);
      log(
        `[${file.pack} ${s.id} ${s.slug ?? ''}] score ${rec.score.toFixed(1)} ${rec.passed ? 'PASS' : 'FAIL'} ` +
          `turns=${rec.latency.turns.length} p95=${(rec.latency.p95Ms / 1000).toFixed(1)}s ended=${rec.endedBy}` +
          `${failed.length ? ' failed=' + failed.join(',') : ''}${rec.judgeError ? ' judgeError' : ''}${rec.error ? ' error=' + rec.error : ''}`,
      );
    }
  }
  k.db.close();

  const perPack = [...new Set(records.map((r) => r.pack))].map((pack) => {
    const rs = records.filter((r) => r.pack === pack);
    return {
      pack,
      tenantName: rs[0].tenantName,
      avgScore: Math.round((rs.reduce((a, r) => a + r.score, 0) / rs.length) * 10) / 10,
      passed: rs.filter((r) => r.passed).length,
      total: rs.length,
      p95Ms: p95(rs.flatMap((r) => r.latency.turns)),
    };
  });
  const allLat = records.flatMap((r) => r.latency.turns);
  return {
    model: opts.model,
    judgeModel: opts.judgeModel ?? opts.model,
    customerModel: opts.customerModel ?? opts.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    liveVision: !!opts.liveVision,
    summary: {
      avgScore: records.length ? Math.round((records.reduce((a, r) => a + r.score, 0) / records.length) * 10) / 10 : 0,
      passed: records.filter((r) => r.passed).length,
      total: records.length,
      latencyP95Ms: p95(allLat),
      latencyGatePassRate: records.length ? Math.round((records.filter((r) => r.latency.gatePass).length / records.length) * 1000) / 10 : 0,
    },
    perPack,
    records,
  };
}
