import { serverNow } from './clock.ts';

export const TZ = 'America/Sao_Paulo';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const enDateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const enDate = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function toDate(v: string | Date): Date {
  return typeof v === 'string' ? new Date(v) : v;
}

export function dayKey(v: string | Date): string {
  return dayFmt.format(toDate(v));
}

function todayKey(): string {
  return dayKey(serverNow());
}

function yesterdayKey(): string {
  return dayKey(new Date(serverNow().getTime() - 86_400_000));
}

export function fmtTime(v: string | Date): string {
  return timeFmt.format(toDate(v));
}

/** Chat list timestamp: HH:MM today, "Ontem", or dd/mm/aaaa. */
export function fmtListTime(v: string | Date): string {
  const k = dayKey(v);
  if (k === todayKey()) return fmtTime(v);
  if (k === yesterdayKey()) return 'Ontem';
  return dateFmt.format(toDate(v));
}

/** Date chip between days in the thread. */
export function fmtDayChip(v: string | Date): string {
  const k = dayKey(v);
  if (k === todayKey()) return 'HOJE';
  if (k === yesterdayKey()) return 'ONTEM';
  return dateFmt.format(toDate(v));
}

/** English list time for the owner inbox. */
export function fmtListTimeEn(v: string | Date): string {
  const k = dayKey(v);
  if (k === todayKey()) return fmtTime(v);
  if (k === yesterdayKey()) return 'Yesterday';
  return enDate.format(toDate(v));
}

export function fmtDayChipEn(v: string | Date): string {
  const k = dayKey(v);
  if (k === todayKey()) return 'TODAY';
  if (k === yesterdayKey()) return 'YESTERDAY';
  return enDate.format(toDate(v)).toUpperCase();
}

export function fmtDateTimeEn(v: string | Date): string {
  return enDateTime.format(toDate(v));
}

export function fmtDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtBRL(n: number): string {
  return brl.format(n).replace(/ /g, ' ');
}

export function fmtRelative(v: string | Date): string {
  const diff = serverNow().getTime() - toDate(v).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/** Small deterministic hash used for waveform bars and avatar colors. */
export function hashNum(input: string | number): number {
  const s = String(input);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const AVATAR_COLORS = ['#3b6fb6', '#c2528b', '#1f9d8f', '#d9822b', '#8a63d2', '#4f8a3a', '#b5533c', '#2d7fa6'];
export function colorFor(name: string): string {
  return AVATAR_COLORS[hashNum(name) % AVATAR_COLORS.length]!;
}

export function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
