import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT } from '../config.ts';

const serviceSchema = z.object({ n: z.string(), p: z.number(), min: z.number() });

export const packSchema = z.object({
  id: z.string(),
  name: z.string(),
  persona_pt: z.string(),
  tone_rules: z.array(z.string()),
  services: z.array(serviceSchema),
  intake_fields: z.array(z.string()),
  booking_rules: z.object({
    slot_min: z.number(),
    buffer_min: z.number(),
    same_day: z.boolean(),
    needs_staff: z.boolean(),
  }),
  quote_logic: z.string(),
  reminders: z.object({
    confirm_24h: z.boolean(),
    confirm_2h: z.boolean(),
    reactivation_days: z.number(),
    reactivation_pt: z.string(),
  }),
  escalation_triggers: z.array(z.string()),
  forbidden: z.array(z.string()),
  regulatory_notes: z.array(z.string()),
  kpis: z.array(z.string()),
  faqs: z.array(z.tuple([z.string(), z.string()])),
});

export type Pack = z.infer<typeof packSchema>;

let cache: Map<string, Pack> | null = null;

export function loadPacks(dir = path.join(ROOT, 'packs')): Map<string, Pack> {
  if (cache && dir === path.join(ROOT, 'packs')) return cache;
  const map = new Map<string, Pack>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const pack = packSchema.parse(JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
    map.set(pack.id, pack);
  }
  cache = map;
  return map;
}

export function getPack(id: string): Pack {
  const p = loadPacks().get(id);
  if (!p) throw new Error(`unknown pack ${id}`);
  return p;
}
