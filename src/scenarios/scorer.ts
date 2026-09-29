// Deterministic checks + rubric scoring. Checks are computed in code and floor/override the judge:
// a failing check forces its axis down; a passing check guarantees a minimum on that axis.

import type { ServiceDTO } from '../shared/api.ts';
import { allowedPrices, extractPrices, inventedDiscount } from '../engine/guard.ts';
import { norm } from '../util/text.ts';
import { AXES, AXIS_KEYS, type AxisKey, type AxisScore, type CheckResult, type JudgeResult, type Scenario } from './types.ts';

export interface Evidence {
  botTexts: string[]; // delivered assistant messages
  rawBotTexts: string[]; // model output before the guard replaced it
  toolCalls: { name: string; ok: boolean }[];
  booked: boolean; // appointment created for the scenario contact (DB)
  escalated: boolean; // escalation row exists for the conversation (DB)
  guardTriggers: number;
  unbackedClaims: number; // model actions the engine had to repair (unbacked claims, book used for a reschedule)
  services: ServiceDTO[];
  quoteTotals: number[];
  pixKey: string;
  ignoreStrings: string[];
  latenciesMs: number[];
}

export const LATENCY_GATE_MS = 20_000;
export const PASS_SCORE = 70;

export function substitute(value: string, ctx: { pixKey: string }): string {
  return value.replaceAll('{tenant.pix_key}', ctx.pixKey);
}

/** Accent/case-insensitive inclusion; numbers also match formatted currency ("1200" ~ "R$ 1.200,00"). */
export function textIncludes(haystack: string, needle: string): boolean {
  const h = norm(haystack);
  const n = norm(needle);
  if (/^\d+$/.test(n)) {
    const withDots = n.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const re = new RegExp(`(?<![\\d.,:]|\\dh)(${n}|${withDots.replace(/\./g, '\\.')})(,00)?(?![\\d:h])`);
    return re.test(h);
  }
  return h.includes(n);
}

export function inventedPrices(texts: string[], ev: Pick<Evidence, 'services' | 'quoteTotals' | 'ignoreStrings'>): number[] {
  const out: number[] = [];
  for (const t of texts) {
    const found = extractPrices(t, { services: ev.services, ignoreStrings: ev.ignoreStrings });
    const allowed = allowedPrices({ services: ev.services, quoteTotals: ev.quoteTotals }, t);
    for (const v of found) if (!allowed.has(v)) out.push(v);
    if (inventedDiscount(t)) out.push(-1); // -1 marks an invented discount/promotion
  }
  return out;
}

export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx];
}

export function computeChecks(s: Scenario, ev: Evidence, judge: JudgeResult | null): CheckResult[] {
  const c = s.checks;
  const out: CheckResult[] = [];
  const all = ev.botTexts.join('\n');
  if (c.no_invented_price) {
    const inv = inventedPrices(ev.botTexts, ev);
    out.push({ name: 'no_invented_price', pass: inv.length === 0, detail: inv.length ? `delivered values not on list: ${inv.join(', ')}` : 'ok' });
  }
  for (const raw of c.must_include ?? []) {
    const needle = substitute(raw, ev);
    const pass = textIncludes(all, needle);
    out.push({ name: `must_include:${raw}`, pass, detail: pass ? 'found' : `"${needle}" not found in assistant messages` });
  }
  for (const raw of c.must_not_include ?? []) {
    const needle = substitute(raw, ev);
    const pass = !textIncludes(all, needle);
    out.push({ name: `must_not_include:${raw}`, pass, detail: pass ? 'absent' : `"${needle}" present` });
  }
  const called = new Set(ev.toolCalls.map((t) => t.name));
  for (const t of c.must_call ?? []) out.push({ name: `must_call:${t}`, pass: called.has(t), detail: called.has(t) ? 'called' : 'not called' });
  for (const t of c.must_not_call ?? []) out.push({ name: `must_not_call:${t}`, pass: !called.has(t), detail: called.has(t) ? 'called' : 'not called' });
  if (c.must_book) out.push({ name: 'must_book', pass: ev.booked, detail: ev.booked ? 'appointment row exists' : 'no appointment in DB' });
  if (c.must_escalate) out.push({ name: 'must_escalate', pass: ev.escalated, detail: ev.escalated ? 'escalation row exists' : 'no escalation' });
  if (c.judge_tone_min !== undefined) {
    const tone = judge?.tone.score ?? 0;
    out.push({ name: `judge_tone_min:${c.judge_tone_min}`, pass: tone >= c.judge_tone_min, detail: `judge tone ${tone}` });
  }
  const p = p95(ev.latenciesMs);
  out.push({ name: 'latency_p95<=20s', pass: p <= LATENCY_GATE_MS, detail: `p95 ${(p / 1000).toFixed(1)}s over ${ev.latenciesMs.length} turns` });
  return out;
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(Number.isFinite(v) ? v : 0)));
}

export function applyChecks(s: Scenario, ev: Evidence, judge: JudgeResult | null, checks: CheckResult[]): Record<AxisKey, AxisScore> {
  const axes = {} as Record<AxisKey, AxisScore>;
  for (const k of AXIS_KEYS) {
    const def = AXES[k];
    axes[k] = judge
      ? { score: clamp(judge[k]?.score, def.max), max: def.max, weight: def.weight, why: judge[k]?.why ?? '', source: 'judge' }
      : { score: 0, max: def.max, weight: def.weight, why: 'judge unavailable', source: 'check' };
  }
  const set = (k: AxisKey, score: number, why: string) => {
    axes[k] = { ...axes[k], score, why, source: 'check' };
  };
  const cap = (k: AxisKey, max: number, why: string) => {
    if (axes[k].score > max) set(k, max, why);
  };
  const floor = (k: AxisKey, min: number, why: string) => {
    if (axes[k].score < min) set(k, min, why);
  };
  const byName = (prefix: string) => checks.filter((c) => c.name === prefix || c.name.startsWith(prefix + ':'));
  const failed = (prefix: string) => byName(prefix).filter((c) => !c.pass);
  const passedAll = (prefix: string) => byName(prefix).length > 0 && failed(prefix).length === 0;

  // Factual grounding
  const inv = checks.find((c) => c.name === 'no_invented_price');
  if (inv && !inv.pass) set('factual_grounding', 0, `check: ${inv.detail}`);
  else if (ev.guardTriggers > 0) cap('factual_grounding', 1, `check: model produced an off-list price ${ev.guardTriggers}x (caught by guard)`);
  const incFails = failed('must_include');
  const numericFail = incFails.filter((c) => /\d|pix/.test(c.name));
  if (numericFail.length) cap('factual_grounding', 1, `check: ${numericFail.map((c) => c.detail).join('; ')}`);
  if (failed('must_not_include').length) cap('factual_grounding', 1, `check: ${failed('must_not_include').map((c) => c.detail).join('; ')}`);
  if (inv?.pass !== false && ev.guardTriggers === 0 && passedAll('must_include') && byName('must_include').some((c) => /\d|pix/.test(c.name))) {
    floor('factual_grounding', 2, 'check: required facts stated exactly');
  }

  // Action correctness
  const actionFails = [...failed('must_call'), ...failed('must_not_call'), ...failed('must_book')];
  if (actionFails.length) set('action_correctness', 0, `check: ${actionFails.map((c) => `${c.name} (${c.detail})`).join('; ')}`);
  else if (byName('must_call').length || byName('must_book').length) floor('action_correctness', 2, 'check: required actions verified in DB/tool log');
  // The engine repairs unbacked action claims before delivery (customer never sees them), but the
  // model still hallucinated an action: cap like a guard trigger instead of failing the scenario.
  if (ev.unbackedClaims > 0) {
    cap('action_correctness', 2, `check: model claimed an action without the tool ${ev.unbackedClaims}x (repaired before delivery)`);
    cap('factual_grounding', 2, `check: unbacked action claim ${ev.unbackedClaims}x (repaired before delivery)`);
  }
  const textFail = incFails.filter((c) => !/\d|pix/.test(c.name));
  if (textFail.length) cap('action_correctness', 1, `check: ${textFail.map((c) => c.detail).join('; ')}`);

  // Escalation judgment
  const esc = checks.find((c) => c.name === 'must_escalate');
  if (esc && !esc.pass) set('escalation_judgment', 0, 'check: escalation required but none recorded');
  else if (esc?.pass) floor('escalation_judgment', 1, 'check: escalation recorded');

  return axes;
}

export function totalScore(axes: Record<AxisKey, AxisScore>): number {
  let got = 0;
  let max = 0;
  for (const k of AXIS_KEYS) {
    got += axes[k].score * axes[k].weight;
    max += axes[k].max * axes[k].weight;
  }
  return Math.round((got / max) * 1000) / 10;
}

export function scoreScenario(s: Scenario, ev: Evidence, judge: JudgeResult | null) {
  const checks = computeChecks(s, ev, judge);
  const axes = applyChecks(s, ev, judge, checks);
  const score = totalScore(axes);
  const p = p95(ev.latenciesMs);
  const gatePass = p <= LATENCY_GATE_MS;
  const passed = checks.every((c) => c.pass) && score >= PASS_SCORE;
  return { checks, axes, score, latency: { turns: ev.latenciesMs, p95Ms: p, maxMs: Math.max(0, ...ev.latenciesMs), gatePass }, passed };
}
