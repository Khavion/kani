import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT } from '../config.ts';

export const scenarioSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),
  title: z.string(),
  persona: z.string(),
  opening: z.array(z.string()).default([]),
  expect: z.string(),
  checks: z
    .object({
      no_invented_price: z.boolean().optional(),
      must_book: z.boolean().optional(),
      must_escalate: z.boolean().optional(),
      must_call: z.array(z.string()).optional(),
      must_not_call: z.array(z.string()).optional(),
      must_include: z.array(z.string()).optional(),
      must_not_include: z.array(z.string()).optional(),
      judge_tone_min: z.number().optional(),
    })
    .default({}),
  audio: z.string().optional(),
  image_description: z.string().optional(),
  image_fixture: z.string().optional(),
  setup: z.string().optional(),
  setup_service: z.string().optional(),
  trigger: z.enum(['no_show_recovery', 'review_request']).optional(),
  clock: z.string().optional(),
  max_turns: z.number().default(8),
});

export type Scenario = z.infer<typeof scenarioSchema>;

export const scenarioFileSchema = z.object({ pack: z.string(), scenarios: z.array(scenarioSchema) });

export function loadScenarioFiles(dir = path.join(ROOT, 'scenarios')): { pack: string; scenarios: Scenario[] }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => scenarioFileSchema.parse(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))));
}

export const AXES = {
  factual_grounding: { max: 3, weight: 2, label: 'Factual grounding' },
  action_correctness: { max: 3, weight: 2, label: 'Action correctness' },
  escalation_judgment: { max: 2, weight: 1, label: 'Escalation judgment' },
  portuguese_quality: { max: 2, weight: 1, label: 'Portuguese quality' },
  tone: { max: 2, weight: 1, label: 'Tone' },
  grievance_mitigated: { max: 3, weight: 2, label: 'Grievance mitigated' },
} as const;

export type AxisKey = keyof typeof AXES;
export const AXIS_KEYS = Object.keys(AXES) as AxisKey[];

export type JudgeResult = Record<AxisKey, { score: number; why: string }>;

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface AxisScore {
  score: number;
  max: number;
  weight: number;
  why: string;
  source: 'judge' | 'check';
}

export interface TranscriptEntry {
  role: 'customer' | 'assistant' | 'owner' | 'system';
  text: string;
  type?: string;
  tools?: string[];
  latencyMs?: number | null;
  guard?: boolean;
  rawText?: string;
  kind?: string;
}

export interface ScenarioRecord {
  pack: string;
  tenantId: string;
  tenantName: string;
  scenario: Scenario;
  transcript: TranscriptEntry[];
  toolCalls: { name: string; ok: boolean; args: Record<string, unknown> }[];
  checks: CheckResult[];
  axes: Record<AxisKey, AxisScore>;
  judge: JudgeResult | null;
  judgeError?: string;
  score: number; // 0-100
  latency: { turns: number[]; p95Ms: number; maxMs: number; gatePass: boolean };
  passed: boolean;
  endedBy: string;
  durationMs: number;
  guardTriggers: number;
  escalated: boolean;
  error?: string;
}

export interface RunSummary {
  model: string;
  judgeModel: string;
  customerModel: string;
  startedAt: string;
  finishedAt: string;
  liveVision: boolean;
  summary: { avgScore: number; passed: number; total: number; latencyP95Ms: number; latencyGatePassRate: number };
  perPack: { pack: string; tenantName: string; avgScore: number; passed: number; total: number; p95Ms: number }[];
  records: ScenarioRecord[];
}
