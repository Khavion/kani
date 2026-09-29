// Tools the assistant can call. Each executes against the DB and returns a JSON-able result
// that is fed back to the model. Validation errors are returned (not thrown) so the model can recover.

import type { Repo, Tenant, Contact, Conversation, Appointment, ReminderKind } from '../db/repo.ts';
import type { Pack } from '../packs/packs.ts';
import type { ServiceDTO, StaffDTO } from '../shared/api.ts';
import type { ToolSpec } from './llm.ts';
import {
  addDays,
  addMinutes,
  formatSlotPt,
  fromLocal,
  hhmmToMinutes,
  parseDateKey,
  parseLocalDateTime,
  slotKey,
  startOfLocalDay,
  toLocal,
  type Clock,
} from '../util/time.ts';
import { norm, tokenOverlap } from '../util/text.ts';

export const TOOL_NAMES = [
  'check_availability',
  'book',
  'reschedule',
  'cancel',
  'create_quote',
  'schedule_reminder',
  'escalate',
  'log_lead',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'check_availability',
    description:
      'Consulta horarios livres na agenda para um servico. Use SEMPRE antes de oferecer horarios. Datas no formato YYYY-MM-DD.',
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Nome do servico exatamente como na lista de servicos' },
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD (padrao: hoje)' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD (padrao: 6 dias depois da inicial)' },
        period: { type: 'string', enum: ['manha', 'tarde', 'noite', 'qualquer'], description: 'Periodo do dia preferido' },
        staff: { type: 'string', description: 'Profissional de preferencia (opcional)' },
      },
      required: ['service'],
    },
  },
  {
    name: 'book',
    description:
      'Cria o agendamento depois que o cliente escolheu um horario retornado por check_availability. Informe o nome do cliente.',
    parameters: {
      type: 'object',
      properties: {
        contact: {
          type: 'object',
          description: 'Dados do cliente',
          properties: { name: { type: 'string' } },
        },
        service: { type: 'string', description: 'Nome do servico da lista' },
        slot: { type: 'string', description: 'Data e hora escolhida, formato "YYYY-MM-DD HH:MM"' },
        staff: { type: 'string', description: 'Profissional (opcional)' },
      },
      required: ['service', 'slot'],
    },
  },
  {
    name: 'reschedule',
    description: 'Remarca um agendamento existente para um novo horario livre ("YYYY-MM-DD HH:MM").',
    parameters: {
      type: 'object',
      properties: {
        appointment_id: { type: 'number', description: 'ID do agendamento (veja "Agendamentos do cliente")' },
        slot: { type: 'string', description: 'Novo horario "YYYY-MM-DD HH:MM"' },
      },
      required: ['slot'],
    },
  },
  {
    name: 'cancel',
    description: 'Cancela um agendamento existente do cliente.',
    parameters: {
      type: 'object',
      properties: { appointment_id: { type: 'number', description: 'ID do agendamento' } },
      required: [],
    },
  },
  {
    name: 'create_quote',
    description:
      'Cria um pre-orcamento SOMENTE com servicos da lista. O total e calculado pelo sistema. Itens fora da lista sao recusados.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { service: { type: 'string' }, qty: { type: 'number' } },
            required: ['service'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'schedule_reminder',
    description: 'Agenda lembretes de confirmacao para um agendamento.',
    parameters: {
      type: 'object',
      properties: {
        appointment_id: { type: 'number' },
        cadence: { type: 'string', enum: ['24h', '2h', 'both'] },
      },
      required: ['cadence'],
    },
  },
  {
    name: 'escalate',
    description:
      'Chama um humano da equipe e pausa o assistente. Use para: preco/servico fora da lista, cliente bravo, reclamacao, pedido de humano, tema de saude/clinico/tecnico fora do escopo, emergencia.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Motivo curto' } },
      required: ['reason'],
    },
  },
  {
    name: 'log_lead',
    description:
      'Registra dados do cliente coletados na conversa (ex.: nome, modelo do carro, placa, nome do pet, porte, convenio, objetivo).',
    parameters: {
      type: 'object',
      properties: {
        fields: { type: 'object', description: 'Pares campo: valor', additionalProperties: { type: 'string' } },
      },
      required: ['fields'],
    },
  },
];

export interface ToolContext {
  repo: Repo;
  clock: Clock;
  tenant: Tenant;
  pack: Pack;
  contact: Contact;
  conversation: Conversation;
  /** Recent customer text in this conversation (lets tools infer intent, e.g. rescheduling). */
  recentCustomerText?: string;
  /** Called after an escalation row is created (engine pauses the bot and notifies the UI). */
  onEscalate?: (reason: string, escalationId: number) => void;
}

export interface ToolResult {
  ok: boolean;
  [k: string]: unknown;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
}

// ---------------------------------------------------------------------------------------------

export function matchService(services: ServiceDTO[], name: unknown): ServiceDTO | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  const n = norm(name);
  const exact = services.find((s) => norm(s.n) === n);
  if (exact) return exact;
  const contains = services.filter((s) => norm(s.n).includes(n) || n.includes(norm(s.n)));
  if (contains.length === 1) return contains[0];
  let best: ServiceDTO | null = null;
  let bestScore = 0;
  for (const s of services) {
    const score = tokenOverlap(s.n, name);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

function staffFor(tenant: Tenant, service: ServiceDTO, preferred?: unknown): StaffDTO[] {
  let staff = tenant.staff.filter((s) => !s.services || s.services.some((x) => norm(x) === norm(service.n)));
  if (staff.length === 0) staff = tenant.staff;
  if (typeof preferred === 'string' && preferred.trim()) {
    const p = norm(preferred);
    const match = staff.filter((s) => norm(s.name).includes(p) || p.includes(norm(s.name).replace(/^dra?\.? /, '')));
    if (match.length) return match;
  }
  return staff;
}

function durationOf(service: ServiceDTO, pack: Pack): number {
  return Math.max(service.min || 0, pack.booking_rules.slot_min);
}

interface SlotCheck {
  ok: boolean;
  reason?: string;
  staff?: string;
}

/** Validate a concrete slot for a service; returns a free staff member when available. */
export function checkSlot(
  ctx: Pick<ToolContext, 'repo' | 'clock' | 'tenant' | 'pack'>,
  service: ServiceDTO,
  start: Date,
  opts: { staff?: unknown; ignoreAppointmentId?: number } = {},
): SlotCheck {
  const { tenant, pack, clock, repo } = ctx;
  const now = clock.now();
  if (start.getTime() < now.getTime() + 15 * 60_000) return { ok: false, reason: 'horario ja passou ou muito em cima' };
  const local = toLocal(start);
  if (!pack.booking_rules.same_day && local.dateKey === toLocal(now).dateKey) {
    return { ok: false, reason: 'nao agendamos para o mesmo dia; ofereca a partir de amanha' };
  }
  const span = tenant.hours[local.weekday];
  if (!span) return { ok: false, reason: `fechado neste dia (${local.weekday})` };
  const dur = durationOf(service, pack);
  const startMin = local.hour * 60 + local.minute;
  if (startMin < hhmmToMinutes(span[0]) || startMin + dur > hhmmToMinutes(span[1])) {
    return { ok: false, reason: `fora do horario de funcionamento (${span[0]}-${span[1]})` };
  }
  if (startMin % pack.booking_rules.slot_min !== 0) {
    return { ok: false, reason: `horarios de ${pack.booking_rules.slot_min} em ${pack.booking_rules.slot_min} minutos` };
  }
  const buffer = pack.booking_rules.buffer_min;
  const end = addMinutes(start, dur);
  const busy = repo
    .activeAppointmentsBetween(tenant.id, addMinutes(start, -buffer).toISOString(), addMinutes(end, buffer).toISOString())
    .filter((a) => a.id !== opts.ignoreAppointmentId);
  for (const s of staffFor(tenant, service, opts.staff)) {
    if (!busy.some((a) => a.staff === s.name)) return { ok: true, staff: s.name };
  }
  return { ok: false, reason: 'horario indisponivel (ja ocupado)' };
}

export function findSlots(
  ctx: Pick<ToolContext, 'repo' | 'clock' | 'tenant' | 'pack'>,
  service: ServiceDTO,
  opts: { from?: Date; to?: Date; period?: string; staff?: unknown; limit?: number },
): { slot: string; label: string; staff: string }[] {
  const { tenant, pack, clock } = ctx;
  const now = clock.now();
  const from = startOfLocalDay(opts.from && opts.from > now ? opts.from : now);
  const to = opts.to ?? addDays(from, 6);
  const period = norm(String(opts.period ?? 'qualquer'));
  const [pStart, pEnd] =
    period === 'manha' ? [0, 12 * 60] : period === 'tarde' ? [12 * 60, 18 * 60] : period === 'noite' ? [18 * 60, 24 * 60] : [0, 24 * 60];
  const perDay = 3;
  const out: { slot: string; label: string; staff: string }[] = [];
  const dur = durationOf(service, pack);
  for (let day = from; day.getTime() <= to.getTime() && out.length < (opts.limit ?? 8); day = addDays(day, 1)) {
    const p = toLocal(day);
    const span = tenant.hours[p.weekday];
    if (!span) continue;
    const dayFree: { slot: string; label: string; staff: string }[] = [];
    for (let m = hhmmToMinutes(span[0]); m + dur <= hhmmToMinutes(span[1]); m += pack.booking_rules.slot_min) {
      if (m < pStart || m >= pEnd) continue;
      const start = fromLocal(p.year, p.month, p.day, Math.floor(m / 60), m % 60);
      const check = checkSlot(ctx, service, start, { staff: opts.staff });
      if (check.ok) dayFree.push({ slot: slotKey(start), label: formatSlotPt(start), staff: check.staff! });
    }
    if (dayFree.length === 0) continue;
    // Spread picks across the day: first, middle, last.
    const picks =
      dayFree.length <= perDay
        ? dayFree
        : [dayFree[0], dayFree[Math.floor(dayFree.length / 2)], dayFree[dayFree.length - 1]];
    for (const s of picks) if (out.length < (opts.limit ?? 8)) out.push(s);
  }
  return out;
}

function parseDay(s: unknown, fallback: Date): Date {
  if (typeof s !== 'string') return fallback;
  const d = parseDateKey(s);
  return d ? fromLocal(d.year, d.month, d.day) : fallback;
}

function resolveAppointment(ctx: ToolContext, id: unknown): Appointment | null {
  const n = typeof id === 'number' ? id : typeof id === 'string' ? Number(id.replace(/\D/g, '')) : NaN;
  if (Number.isFinite(n) && n > 0) {
    const a = ctx.repo.getAppointment(n);
    if (a && a.contactId === ctx.contact.id) return a;
  }
  // Default: the contact's next active appointment (or most recent one).
  const mine = ctx.repo.appointmentsForContact(ctx.contact.id).filter((a) => a.status === 'booked' || a.status === 'confirmed');
  const now = ctx.clock.now().toISOString();
  return mine.find((a) => a.startsAt >= now) ?? mine[mine.length - 1] ?? null;
}

export function scheduleDefaultReminders(ctx: Pick<ToolContext, 'repo' | 'clock' | 'pack'>, appt: Appointment): ReminderKind[] {
  const kinds: ReminderKind[] = [];
  if (ctx.pack.reminders.confirm_24h) kinds.push('confirm_24h');
  if (ctx.pack.reminders.confirm_2h) kinds.push('confirm_2h');
  return createReminders(ctx, appt, kinds);
}

function createReminders(ctx: Pick<ToolContext, 'repo' | 'clock'>, appt: Appointment, kinds: ReminderKind[]): ReminderKind[] {
  const created: ReminderKind[] = [];
  const existing = ctx.repo.remindersForAppointment(appt.id);
  const now = ctx.clock.now().getTime();
  for (const kind of kinds) {
    if (existing.some((r) => r.kind === kind && !r.sent)) continue;
    const hours = kind === 'confirm_24h' ? 24 : 2;
    const fireAt = new Date(new Date(appt.startsAt).getTime() - hours * 3_600_000);
    if (fireAt.getTime() <= now) continue; // too close; no point reminding
    ctx.repo.insertReminder({
      appointmentId: appt.id,
      tenantId: appt.tenantId,
      contactId: appt.contactId,
      fireAt: fireAt.toISOString(),
      kind,
    });
    created.push(kind);
  }
  return created;
}

// ---------------------------------------------------------------------------------------------

export async function executeTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const { repo, tenant, pack, contact, conversation, clock } = ctx;
  const services = tenant.services;
  const logBase = { conversation_id: conversation.id, contact_id: contact.id };

  switch (name) {
    case 'check_availability': {
      const service = matchService(services, args.service);
      if (!service) {
        return { ok: false, error: 'servico nao encontrado na lista', servicos_validos: services.map((s) => s.n) };
      }
      const today = startOfLocalDay(clock.now());
      const from = parseDay(args.date_from, today);
      const to = parseDay(args.date_to, addDays(from, 6));
      let slots = findSlots(ctx, service, { from, to, period: args.period as string, staff: args.staff });
      let note: string | undefined;
      if (slots.length === 0) {
        slots = findSlots(ctx, service, { from, to: addDays(from, 10), period: 'qualquer', staff: args.staff });
        note = slots.length ? 'sem vagas no periodo pedido; estes sao os proximos horarios livres' : undefined;
      }
      return {
        ok: true,
        service: service.n,
        duration_min: service.min,
        slots,
        ...(note ? { note } : {}),
        nota_interna: 'ofereca ao cliente 2 destes horarios (campo label); nao invente horarios',
      };
    }

    case 'book': {
      const service = matchService(services, args.service);
      if (!service) return { ok: false, error: 'servico nao encontrado na lista', servicos_validos: services.map((s) => s.n) };
      const start = typeof args.slot === 'string' ? parseLocalDateTime(args.slot) : null;
      if (!start) return { ok: false, error: 'slot invalido; use "YYYY-MM-DD HH:MM" retornado por check_availability' };
      // Rescheduling intent + an existing future appointment for this service: move it instead of
      // creating a second one (models sometimes call book when they mean reschedule).
      const wantsMove = /remarc|mudar|trocar|adiar|outro dia|outro horario|reagend/.test(norm(ctx.recentCustomerText ?? ''));
      const existing = repo
        .appointmentsForContact(contact.id)
        .find((a) => a.service === service.n && (a.status === 'booked' || a.status === 'confirmed') && a.startsAt > clock.now().toISOString());
      if (wantsMove && existing && existing.startsAt !== start.toISOString()) {
        const moved = await executeTool(ctx, 'reschedule', { appointment_id: existing.id, slot: args.slot });
        return { ...moved, converted_from: 'book', nota_interna: 'o agendamento existente foi remarcado (nao foi criado outro)' };
      }
      const contactArg = args.contact as { name?: string } | string | undefined;
      const name = typeof contactArg === 'string' ? contactArg : contactArg?.name;
      // Idempotency: same contact, same service, same start.
      const dup = repo
        .appointmentsForContact(contact.id)
        .find((a) => a.service === service.n && a.startsAt === start.toISOString() && (a.status === 'booked' || a.status === 'confirmed'));
      if (dup) {
        return { ok: true, appointment_id: dup.id, service: dup.service, when: formatSlotPt(start), staff: dup.staff, already: true };
      }
      const check = checkSlot(ctx, service, start, { staff: args.staff });
      if (!check.ok) {
        const alternatives = findSlots(ctx, service, { from: start, limit: 3 });
        return { ok: false, error: check.reason, alternativas: alternatives };
      }
      if (name && name.trim()) {
        repo.mergeContactProfile(contact.id, { nome: name.trim() });
      }
      const appt = repo.insertAppointment({
        tenantId: tenant.id,
        contactId: contact.id,
        service: service.n,
        staff: check.staff ?? null,
        startsAt: start.toISOString(),
        endsAt: addMinutes(start, durationOf(service, pack)).toISOString(),
        price: service.p,
        source: 'bot',
        conversationId: conversation.id,
      });
      const reminders = scheduleDefaultReminders(ctx, appt);
      repo.logEvent(tenant.id, 'booking_created', { ...logBase, appointment_id: appt.id, service: service.n, price: service.p });
      return {
        ok: true,
        appointment_id: appt.id,
        service: service.n,
        when: formatSlotPt(start),
        staff: appt.staff,
        price: service.p,
        reminders,
      };
    }

    case 'reschedule': {
      const appt = resolveAppointment(ctx, args.appointment_id);
      if (!appt) return { ok: false, error: 'nenhum agendamento ativo encontrado para este cliente' };
      if (appt.status === 'cancelled' || appt.status === 'done') {
        return { ok: false, error: `agendamento esta ${appt.status}` };
      }
      const service = matchService(services, appt.service) ?? { n: appt.service, p: appt.price ?? 0, min: pack.booking_rules.slot_min };
      const start = typeof args.slot === 'string' ? parseLocalDateTime(args.slot) : null;
      if (!start) {
        const alternatives = findSlots(ctx, service, { limit: 4 });
        return { ok: false, error: 'informe o novo horario "YYYY-MM-DD HH:MM"', alternativas: alternatives };
      }
      const check = checkSlot(ctx, service, start, { staff: appt.staff, ignoreAppointmentId: appt.id });
      const check2 = check.ok ? check : checkSlot(ctx, service, start, { ignoreAppointmentId: appt.id });
      if (!check2.ok) {
        return { ok: false, error: check2.reason, alternativas: findSlots(ctx, service, { from: start, limit: 3 }) };
      }
      const updated = repo.updateAppointment(appt.id, {
        startsAt: start.toISOString(),
        endsAt: addMinutes(start, durationOf(service, pack)).toISOString(),
        staff: check2.staff ?? appt.staff,
        status: 'booked',
      });
      repo.deleteUnsentReminders(appt.id);
      scheduleDefaultReminders(ctx, updated);
      repo.logEvent(tenant.id, 'appointment_rescheduled', { ...logBase, appointment_id: appt.id, from: appt.startsAt, to: updated.startsAt });
      return { ok: true, appointment_id: appt.id, service: appt.service, when: formatSlotPt(start), staff: updated.staff };
    }

    case 'cancel': {
      const appt = resolveAppointment(ctx, args.appointment_id);
      if (!appt) return { ok: false, error: 'nenhum agendamento ativo encontrado para este cliente' };
      if (appt.status === 'cancelled') return { ok: true, appointment_id: appt.id, already: true };
      repo.updateAppointment(appt.id, { status: 'cancelled' });
      repo.deleteUnsentReminders(appt.id);
      repo.logEvent(tenant.id, 'appointment_cancelled', { ...logBase, appointment_id: appt.id });
      return {
        ok: true,
        appointment_id: appt.id,
        service: appt.service,
        was: formatSlotPt(new Date(appt.startsAt)),
        nota_interna: 'confirme o cancelamento com empatia e ofereca remarcar quando o cliente quiser',
      };
    }

    case 'create_quote': {
      const raw = Array.isArray(args.items) ? args.items : [];
      if (raw.length === 0) return { ok: false, error: 'informe ao menos um item da lista' };
      const items: { service: string; qty: number; price: number }[] = [];
      const unknown: string[] = [];
      for (const it of raw) {
        const nameArg = typeof it === 'string' ? it : (it as { service?: string; name?: string })?.service ?? (it as { name?: string })?.name;
        const qty = typeof it === 'object' && it && Number((it as { qty?: number }).qty) > 0 ? Number((it as { qty?: number }).qty) : 1;
        const s = matchService(services, nameArg);
        if (!s) unknown.push(String(nameArg));
        else items.push({ service: s.n, qty, price: s.p });
      }
      if (unknown.length) {
        return {
          ok: false,
          error: 'itens fora da lista nao podem ser orcados pelo assistente',
          itens_fora_da_lista: unknown,
          nota_interna: 'diga ao cliente que vai confirmar com a equipe e use escalate',
        };
      }
      const total = items.reduce((acc, i) => acc + i.price * i.qty, 0);
      const quote = repo.insertQuote({ tenantId: tenant.id, contactId: contact.id, conversationId: conversation.id, items, total });
      repo.logEvent(tenant.id, 'quote_sent', { ...logBase, quote_id: quote.id, total });
      return {
        ok: true,
        quote_id: quote.id,
        items,
        total,
        nota_interna:
          pack.id === 'oficina'
            ? 'apresente o pre-orcamento itemizado e peca autorizacao expressa (ex.: responder "aprovo") antes de executar'
            : 'apresente o orcamento itemizado ao cliente',
      };
    }

    case 'schedule_reminder': {
      const appt = resolveAppointment(ctx, args.appointment_id);
      if (!appt) return { ok: false, error: 'nenhum agendamento ativo encontrado' };
      const cadence = String(args.cadence ?? 'both');
      const kinds: ReminderKind[] = cadence === '24h' ? ['confirm_24h'] : cadence === '2h' ? ['confirm_2h'] : ['confirm_24h', 'confirm_2h'];
      const created = createReminders(ctx, appt, kinds);
      return { ok: true, appointment_id: appt.id, scheduled: created };
    }

    case 'escalate': {
      const reason = String(args.reason ?? 'sem motivo informado').slice(0, 200);
      const esc = repo.insertEscalation(conversation.id, reason);
      repo.logEvent(tenant.id, 'escalation', { ...logBase, escalation_id: esc.id, reason, source: 'tool' });
      ctx.onEscalate?.(reason, esc.id);
      return {
        ok: true,
        escalation_id: esc.id,
        nota_interna: 'avise o cliente, com acolhimento, que alguem da equipe vai continuar o atendimento em breve; nao prometa prazos',
      };
    }

    case 'log_lead': {
      const fields = (args.fields && typeof args.fields === 'object' ? args.fields : args) as Record<string, unknown>;
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (k === 'fields') continue;
        if (v === null || v === undefined) continue;
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (s.trim()) clean[norm(k).replace(/\s+/g, '_').slice(0, 40)] = s.slice(0, 200);
      }
      if (Object.keys(clean).length === 0) return { ok: false, error: 'nenhum campo informado' };
      repo.mergeContactProfile(contact.id, clean);
      repo.logEvent(tenant.id, 'lead_logged', { ...logBase, fields: clean });
      return { ok: true, saved: Object.keys(clean) };
    }

    default:
      return { ok: false, error: `ferramenta desconhecida: ${name}` };
  }
}
