// Cron-style scheduler: fires due reminders, creates reactivation reminders, and refreshes
// contact memory for idle conversations. Uses the engine Clock, so POST /api/dev/time-travel
// makes reminders fire instantly in tests and demos.

import type { Engine } from '../engine/engine.ts';
import type { Repo } from '../db/repo.ts';
import { getPack } from '../packs/packs.ts';
import { addDays, fromLocal, isOpenAt, toLocal, WEEKDAYS, hhmmToMinutes, type Clock } from '../util/time.ts';
import type { HoursMap } from '../shared/api.ts';

export interface TickResult {
  fired: number;
  reactivationsQueued: number;
  summaries: number;
}

export interface SchedulerOptions {
  tickMs: number;
  memorySummaries?: boolean;
  idleMinutesForSummary?: number;
}

/** Next instant the business is open (for sending proactive messages at a decent hour). */
export function nextOpening(hours: HoursMap, from: Date): Date {
  if (isOpenAt(hours, from)) return from;
  for (let i = 0; i < 8; i++) {
    const day = addDays(from, i);
    const p = toLocal(day);
    const span = hours[WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]];
    if (!span) continue;
    const open = fromLocal(p.year, p.month, p.day, Math.floor(hhmmToMinutes(span[0]) / 60), hhmmToMinutes(span[0]) % 60);
    const openAt = new Date(open.getTime() + 30 * 60_000); // half an hour after opening
    if (openAt.getTime() > from.getTime()) return openAt;
  }
  return from;
}

export class Scheduler {
  private readonly engine: Engine;
  private readonly repo: Repo;
  private readonly clock: Clock;
  private readonly opts: Required<SchedulerOptions>;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<TickResult> | null = null;
  private summarized = new Map<number, string>();
  private readonly startedAt: string;

  constructor(engine: Engine, opts: SchedulerOptions) {
    this.engine = engine;
    this.repo = engine.repo;
    this.clock = engine.clock;
    this.opts = { memorySummaries: true, idleMinutesForSummary: 30, ...opts };
    this.startedAt = this.clock.nowIso();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => console.error('[scheduler]', err));
    }, this.opts.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One scheduler pass. Concurrent calls share the same in-flight pass. */
  tick(): Promise<TickResult> {
    if (this.running) return this.running;
    this.running = this.doTick().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async timeTravel(hours: number): Promise<TickResult & { now: string; offsetHours: number }> {
    this.clock.advanceHours(hours);
    if (this.running) await this.running;
    const res = await this.tick();
    return { ...res, now: this.clock.nowIso(), offsetHours: this.clock.offsetHours };
  }

  private async doTick(): Promise<TickResult> {
    const reactivationsQueued = this.queueReactivations();
    let fired = 0;
    for (const rem of this.repo.dueReminders(this.clock.nowIso())) {
      try {
        const msg = await this.engine.sendReminder(rem);
        if (msg) fired++;
      } catch (err) {
        console.error('[scheduler] reminder', rem.id, (err as Error).message);
        this.repo.markReminderSent(rem.id);
        this.repo.setReminderResponse(rem.id, 'error');
      }
    }
    const summaries = this.opts.memorySummaries ? await this.summarizeIdle() : 0;
    return { fired, reactivationsQueued, summaries };
  }

  /** Contacts with no visit in pack.reactivation_days (and nothing booked) get one reactivation. */
  queueReactivations(): number {
    const now = this.clock.now();
    let queued = 0;
    for (const tenant of this.repo.listTenants()) {
      const pack = getPack(tenant.packId);
      const days = pack.reminders.reactivation_days;
      const cutoff = addDays(now, -days).toISOString();
      const rows = this.repo.query(
        `SELECT c.id AS contact_id, MAX(a.starts_at) AS last_visit, MAX(a.id) AS last_appt
         FROM contacts c JOIN appointments a ON a.contact_id = c.id AND a.status = 'done'
         WHERE c.tenant_id = ? AND c.opt_out = 0
         GROUP BY c.id HAVING last_visit < ?`,
        tenant.id,
        cutoff,
      );
      for (const r of rows) {
        const contactId = Number(r.contact_id);
        const appts = this.repo.appointmentsForContact(contactId);
        const upcoming = appts.some((a) => (a.status === 'booked' || a.status === 'confirmed') && a.startsAt > now.toISOString());
        if (upcoming) continue;
        const recent = this.repo
          .remindersForContact(contactId)
          .some((x) => x.kind === 'reactivation' && x.createdAt > cutoff);
        if (recent) continue;
        this.repo.insertReminder({
          appointmentId: Number(r.last_appt),
          tenantId: tenant.id,
          contactId,
          fireAt: nextOpening(tenant.hours, now).toISOString(),
          kind: 'reactivation',
        });
        queued++;
      }
    }
    return queued;
  }

  private async summarizeIdle(): Promise<number> {
    const idleBefore = new Date(this.clock.now().getTime() - this.opts.idleMinutesForSummary * 60_000).toISOString();
    const rows = this.repo.query(
      `SELECT id, last_msg_at FROM conversations WHERE last_msg_at IS NOT NULL AND last_msg_at < ? AND last_msg_at > ?
       ORDER BY last_msg_at DESC LIMIT 5`,
      idleBefore,
      this.startedAt,
    );
    let n = 0;
    for (const r of rows) {
      const id = Number(r.id);
      if (this.summarized.get(id) === r.last_msg_at) continue;
      this.summarized.set(id, r.last_msg_at);
      const count = this.repo.query(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'customer'`, id)[0];
      if (Number(count?.n ?? 0) < 2) continue;
      try {
        if (await this.engine.summarizeContact(id)) n++;
      } catch (err) {
        console.error('[scheduler] memory', id, (err as Error).message);
      }
      if (n >= 2) break; // keep the single generation queue free for live chats
    }
    return n;
  }
}
