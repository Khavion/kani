import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreScenario, textIncludes, type Evidence } from '../src/scenarios/scorer.ts';
import { AXIS_KEYS, AXES, scenarioSchema, type JudgeResult } from '../src/scenarios/types.ts';
import { getPack } from '../src/packs/packs.ts';

const perfectJudge = Object.fromEntries(AXIS_KEYS.map((k) => [k, { score: AXES[k].max, why: 'judge says perfect' }])) as JudgeResult;

function evidence(over: Partial<Evidence> = {}): Evidence {
  return {
    botTexts: ['A troca de oleo + filtro sai R$180. Quer agendar amanha?'],
    rawBotTexts: [],
    toolCalls: [],
    booked: false,
    escalated: false,
    guardTriggers: 0,
    unbackedClaims: 0,
    services: getPack('oficina').services,
    quoteTotals: [],
    pixKey: 'abc-123',
    ignoreStrings: [],
    latenciesMs: [5000, 6000],
    ...over,
  };
}

const s01 = scenarioSchema.parse({
  id: 's01',
  title: 'preco',
  persona: 'cliente',
  opening: ['qnto ta a troca de oleo?'],
  expect: 'preco exato',
  checks: { no_invented_price: true, must_include: ['180'] },
});

test('scoring: judge 3/3 but an invented price forces grounding to 0', () => {
  const r = scoreScenario(s01, evidence({ botTexts: ['A troca de oleo sai R$199, bora?'] }), perfectJudge);
  assert.equal(r.axes.factual_grounding.score, 0);
  assert.equal(r.axes.factual_grounding.source, 'check');
  assert.equal(r.passed, false);
  assert.ok(r.score < 100);
});

test('scoring: a perfect run scores 100 and passes', () => {
  const r = scoreScenario(s01, evidence(), perfectJudge);
  assert.equal(r.score, 100);
  assert.equal(r.passed, true);
});

test('scoring: passing checks floor a pessimistic judge; failing action checks zero it', () => {
  const lowJudge = Object.fromEntries(AXIS_KEYS.map((k) => [k, { score: 0, why: 'judge says bad' }])) as JudgeResult;
  const booking = scenarioSchema.parse({ id: 's03', title: 't', persona: 'p', expect: 'e', checks: { must_book: true } });
  const ok = scoreScenario(booking, evidence({ booked: true }), lowJudge);
  assert.equal(ok.axes.action_correctness.score, 2, 'DB-verified booking floors action at 2');
  const bad = scoreScenario(booking, evidence({ booked: false }), perfectJudge);
  assert.equal(bad.axes.action_correctness.score, 0, 'no appointment row: action 0 even if judge says 3');
  const esc = scenarioSchema.parse({ id: 's09', title: 't', persona: 'p', expect: 'e', checks: { must_escalate: true } });
  assert.equal(scoreScenario(esc, evidence({ escalated: false }), perfectJudge).axes.escalation_judgment.score, 0);
});

test('scoring: guard triggers cap grounding at 1 and latency gate fails above 20s', () => {
  const r = scoreScenario(s01, evidence({ guardTriggers: 1, latenciesMs: [25_000] }), perfectJudge);
  assert.equal(r.axes.factual_grounding.score, 1);
  assert.equal(r.latency.gatePass, false);
  assert.equal(r.passed, false);
});

test('scoring: must_include matches formatted currency and accents', () => {
  assert.equal(textIncludes('Pacote por R$ 1.200,00', '1200'), true);
  assert.equal(textIncludes('sai R$180.', '180'), true);
  assert.equal(textIncludes('as 11:30', '30'), false, 'a time is not a price');
  assert.equal(textIncludes('Deixa sua avaliação no Google', 'avalia'), true);
});
