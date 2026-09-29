// Server clock tracking. The backend supports dev time travel, so "today" must be
// computed from the server clock rather than the browser clock.
let offsetMs = 0;
const listeners = new Set<() => void>();

export function setServerOffsetHours(hours: number): void {
  const next = Math.round(hours * 3600_000);
  if (next === offsetMs) return;
  offsetMs = next;
  listeners.forEach((l) => l());
}

export function setServerNow(iso: string): void {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return;
  // Snap to whole minutes of drift to avoid jitter from network latency.
  const drift = t - Date.now();
  const rounded = Math.round(drift / 60_000) * 60_000;
  if (rounded === offsetMs) return;
  offsetMs = rounded;
  listeners.forEach((l) => l());
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function onClockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
