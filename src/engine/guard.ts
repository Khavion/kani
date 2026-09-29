// Price guard: runs on every assistant reply before it is sent.
// Extracts R$ amounts and bare price-like numerals; any value that is not backed by the
// tenant's services_json (or a value derived from it, see allowedPrices) blocks the reply.

import type { ServiceDTO } from '../shared/api.ts';
import { norm } from '../util/text.ts';

export const GUARD_REPLY = 'vou confirmar esse valor certinho e já te retorno';

export interface GuardContext {
  services: ServiceDTO[];
  /** Totals of quotes created by create_quote in this conversation. */
  quoteTotals?: number[];
  /** Tenant strings that contain digits but are not prices (address, phone, pix key, links). */
  ignoreStrings?: string[];
}

export interface GuardResult {
  ok: boolean;
  found: number[];
  offending: number[];
}

const UNIT_AFTER =
  /^\s*(h\b|hs\b|hr|hora|min\b|mins\b|minuto|dia|mes|meses|ano|semana|x\b|vez|vezes|%|km|kg|ml|cm|mm|g\b|ah\b|sess|drenage|dose|porte|dente|unidade|pe[cç]a|parcela|vaga|horario|hor[aá]rio|pessoa|cliente|mensage|foto|carro|pet|filhote|cachorro|gato|anos?\b|º|ª|°|o\b|a\b)/i;
const TIME_BEFORE = /(?:\bàs|\bas|\bdas|\bate as|\baté às|\bdia|\bdias|#|n[º°]|\bnumero|\bnúmero|\bplaca|\bcep)\s*$/i;
const PRICE_CUES = [
  'r$',
  'real',
  'reais',
  'custa',
  'custam',
  'custo',
  'sai ',
  'saem',
  'sairia',
  'fica ',
  'ficam',
  'ficaria',
  'valor',
  'preco',
  'total',
  'cobramos',
  'cobra ',
  'cobrar',
  'cobrado',
  'por ',
  'pague',
  'pagar',
  'investimento',
  'a partir de',
  'apenas',
  'promocao',
  'desconto',
  'orcamento',
];

const GENERIC_SERVICE_WORDS = new Set(['sessao', 'porte', 'para', 'com', 'por', 'dente', 'parceiro', 'mensal', 'simples']);

function serviceTokens(services: ServiceDTO[]): string[] {
  const out = new Set<string>();
  for (const s of services) {
    for (const w of norm(s.n).split(/[^a-z0-9]+/)) {
      if (w.length >= 4 && !GENERIC_SERVICE_WORDS.has(w)) out.add(w);
    }
  }
  return [...out];
}

function parseAmount(intPart: string, decPart?: string): number {
  const int = Number(intPart.replace(/\./g, ''));
  const dec = decPart ? Number(`0.${decPart}`) : 0;
  return Math.round((int + dec) * 100) / 100;
}

/** Return every price-like value mentioned in `text`. */
export function extractPrices(text: string, ctx: Pick<GuardContext, 'services' | 'ignoreStrings'>): number[] {
  let t = text;
  // Remove URLs, e-mails, tenant data strings and phone-like numbers.
  t = t.replace(/https?:\/\/\S+/gi, ' ').replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, ' ');
  for (const s of ctx.ignoreStrings ?? []) {
    if (s && s.length >= 4) t = t.split(s).join(' ');
  }
  t = t.replace(/\+?\d{2}\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g, ' ');
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ');

  const found: number[] = [];
  // 1) Explicit currency: R$ 1.200,00 / R$180 / R$ 99,90
  t = t.replace(/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/gi, (_m, i: string, d?: string) => {
    found.push(parseAmount(i, d));
    return ' ';
  });

  // Numbers that literally appear in tenant data (street number, CEP) are not prices when bare.
  const tenantNumerals = new Set<number>();
  for (const s of ctx.ignoreStrings ?? []) for (const m of s.matchAll(/\d+/g)) tenantNumerals.add(Number(m[0]));

  const tokens = serviceTokens(ctx.services);
  // 2) Bare numerals with price context
  const re = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?/g;
  for (const m of t.matchAll(re)) {
    const idx = m.index ?? 0;
    const raw = m[0];
    const before = t.slice(Math.max(0, idx - 40), idx);
    const after = t.slice(idx + raw.length, idx + raw.length + 14);
    const prevCh = t[idx - 1] ?? ' ';
    const nextCh = t[idx + raw.length] ?? ' ';
    if (/[\w/:.,]/.test(prevCh) && !/[\s(]/.test(prevCh)) continue; // part of token, date, time, decimal
    if (/[\w/:%]/.test(nextCh)) continue; // 60Ah, 14h, 29/09, 10:30, 50%
    const value = parseAmount(m[1], m[2]);
    if (value < 10) continue; // counts, single digits
    if (!m[2] && !raw.includes('.') && value >= 1950 && value <= 2035) continue; // years
    if (UNIT_AFTER.test(after)) continue;
    if (TIME_BEFORE.test(before)) continue;
    const followedByCurrency = /^\s*(reais|real|conto|pila|,00)/i.test(after);
    if (tenantNumerals.has(value) && !followedByCurrency) continue;
    // Only look back within the current sentence.
    const sentence = norm(before.split(/[.!?\n]/).pop() ?? '');
    const hasCue = PRICE_CUES.some((c) => sentence.includes(c)) || tokens.some((w) => sentence.includes(w));
    if (followedByCurrency || hasCue) found.push(value);
  }
  return found;
}

/** Values the assistant may state: list prices, 0, quote totals, installments, and pair combos. */
export function allowedPrices(ctx: GuardContext, text = ''): Set<number> {
  const base = ctx.services.map((s) => s.p);
  const allowed = new Set<number>([0, ...base, ...(ctx.quoteTotals ?? [])]);
  const positive = base.filter((p) => p > 0);
  for (let i = 0; i < positive.length; i++) {
    for (let j = i + 1; j < positive.length; j++) allowed.add(positive[i] + positive[j]);
  }
  if (/\d+\s*x\b|parcel/i.test(text)) {
    for (const p of [...positive, ...(ctx.quoteTotals ?? [])]) {
      for (let n = 2; n <= 12; n++) allowed.add(Math.round((p / n) * 100) / 100);
    }
  }
  return allowed;
}

export function checkPrices(text: string, ctx: GuardContext): GuardResult {
  const found = extractPrices(text, ctx);
  const allowed = allowedPrices(ctx, text);
  const offending = found.filter((v) => !allowed.has(v));
  return { ok: offending.length === 0, found, offending };
}

/**
 * Odonto rule: prices only when the customer asks directly. Removes sentences that state
 * prices when the last customer message did not ask about price.
 */
export function asksAboutPrice(customerText: string): boolean {
  return /\b(quanto|qnto|qto|preco|precos|valor|valores|custa|custo|sai por|cobra|tabela|orcamento|r\$|\$|pagar|parcel|caro|barato)/.test(
    norm(customerText),
  );
}

export function stripPriceSentences(text: string, ctx: GuardContext): string {
  const parts = text.split(/(?<=[.!?\n])\s+/);
  const kept = parts.filter((p) => extractPrices(p, ctx).filter((v) => v > 0).length === 0);
  return kept.join(' ').trim();
}
