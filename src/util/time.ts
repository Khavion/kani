// Time helpers for Sao Paulo tenants. Brazil abolished DST in 2019, so local time is a fixed UTC-3.
// Using a fixed offset keeps the engine deterministic and independent of the host ICU data.

import type { HoursMap } from '../shared/api.ts';

export const SP_OFFSET_MIN = -180;
const OFFSET_MS = SP_OFFSET_MIN * 60_000;

export const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
export type WeekdayKey = (typeof WEEKDAYS)[number];
export const WEEKDAY_LONG: Record<WeekdayKey, string> = {
  dom: 'domingo',
  seg: 'segunda-feira',
  ter: 'terça-feira',
  qua: 'quarta-feira',
  qui: 'quinta-feira',
  sex: 'sexta-feira',
  sab: 'sábado',
};

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: WeekdayKey;
  dateKey: string; // YYYY-MM-DD
  hhmm: string; // HH:MM
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocal(d: Date): LocalParts {
  const s = new Date(d.getTime() + OFFSET_MS);
  const year = s.getUTCFullYear();
  const month = s.getUTCMonth() + 1;
  const day = s.getUTCDate();
  const hour = s.getUTCHours();
  const minute = s.getUTCMinutes();
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: WEEKDAYS[s.getUTCDay()],
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
    hhmm: `${pad(hour)}:${pad(minute)}`,
  };
}

/** Build a UTC Date from Sao Paulo local wall-clock components. */
export function fromLocal(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - OFFSET_MS);
}

/** Parse "YYYY-MM-DD HH:MM" / "YYYY-MM-DDTHH:MM" (local) or a full ISO string with zone. */
export function parseLocalDateTime(s: string): Date | null {
  const trimmed = s.trim();
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(trimmed) && trimmed.includes('T')) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return fromLocal(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
}

export function parseDateKey(s: string): { year: number; month: number; day: number } | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function addMinutes(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000);
}

/** Local midnight (Sao Paulo) of the given instant. */
export function startOfLocalDay(d: Date): Date {
  const p = toLocal(d);
  return fromLocal(p.year, p.month, p.day);
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** "ter 29/09 às 14:00" */
export function formatSlotPt(d: Date): string {
  const p = toLocal(d);
  return `${p.weekday} ${pad(p.day)}/${pad(p.month)} às ${p.hhmm}`;
}

/** "terça-feira, 29/09/2026" */
export function formatDatePt(d: Date): string {
  const p = toLocal(d);
  return `${WEEKDAY_LONG[p.weekday]}, ${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

export function slotKey(d: Date): string {
  const p = toLocal(d);
  return `${p.dateKey} ${p.hhmm}`;
}

export function isOpenAt(hours: HoursMap, d: Date): boolean {
  const p = toLocal(d);
  const span = hours[p.weekday];
  if (!span) return false;
  const m = p.hour * 60 + p.minute;
  return m >= hhmmToMinutes(span[0]) && m < hhmmToMinutes(span[1]);
}

export function formatHoursPt(hours: HoursMap): string {
  const order: WeekdayKey[] = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  const fmt = (span: [string, string] | null) => (span ? `${span[0].replace(':00', 'h')}-${span[1].replace(':00', 'h')}` : 'fechado');
  // Group consecutive days with identical spans: "seg a sex 8h-18h; sab 8h-12h; dom fechado"
  const groups: { from: WeekdayKey; to: WeekdayKey; label: string }[] = [];
  for (const day of order) {
    const label = fmt(hours[day]);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.to = day;
    else groups.push({ from: day, to: day, label });
  }
  return groups.map((g) => (g.from === g.to ? `${g.from} ${g.label}` : `${g.from} a ${g.to} ${g.label}`)).join('; ');
}

/**
 * Process clock with a dev/test offset. `freeze(at)` pins wall-clock time to a given instant
 * (it still advances with real elapsed time so message ordering stays natural).
 */
export class Clock {
  private offsetMs = 0;
  private frozenAt: number | null = null;
  private frozenReal = 0;

  now(): Date {
    const base = this.frozenAt === null ? Date.now() : this.frozenAt + (Date.now() - this.frozenReal);
    return new Date(base + this.offsetMs);
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  advanceHours(hours: number): Date {
    this.offsetMs += hours * 3_600_000;
    return this.now();
  }

  freeze(at: Date): void {
    this.frozenAt = at.getTime();
    this.frozenReal = Date.now();
    this.offsetMs = 0;
  }

  get offsetHours(): number {
    return this.offsetMs / 3_600_000;
  }
}
