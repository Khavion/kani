/** Lowercase, strip accents, collapse whitespace. Used for keyword matching in pt-BR. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove em/en dashes from generated copy (product rule: never use travessao). */
export function stripDashes(s: string): string {
  return s
    .replace(/\s*[—―]\s*/g, ', ')
    .replace(/(\d)\s*–\s*(\d)/g, '$1-$2')
    .replace(/\s*–\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/^,\s*/gm, '');
}

/** Strip <think>...</think> blocks some reasoning models emit. */
export function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*<\/?think>\s*/gi, '').trim();
}

export function formatBRL(v: number): string {
  const fixed = Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  const [int, dec] = fixed.split(',');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$${withSep}${dec ? ',' + dec : ''}`;
}

/** Simple similarity for fuzzy service-name matching (token overlap on normalized words). */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(norm(a).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const tb = new Set(norm(b).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const w of ta) if (tb.has(w) || [...tb].some((x) => x.startsWith(w) || w.startsWith(x))) hits++;
  // Divide by the larger set so a single shared generic word ("troca") is not a match.
  return hits / Math.max(ta.size, tb.size);
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
