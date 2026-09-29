// Typed data access for Kani. All SQL lives here; the engine only calls these methods.

import type { DB } from './db.ts';
import type { Clock } from '../util/time.ts';
import { safeJson } from '../util/text.ts';
import type {
  AppointmentDTO,
  AppointmentStatus,
  ContactDTO,
  ConvStatus,
  ConversationDTO,
  EscalationDTO,
  HoursMap,
  MessageDTO,
  MessageMeta,
  MsgStatus,
  MsgType,
  QuoteDTO,
  QuoteStatus,
  Role,
  ServiceDTO,
  StaffDTO,
  TenantDTO,
} from '../shared/api.ts';
import { getPack } from '../packs/packs.ts';

type SqlVal = string | number | null;

export interface TenantSettings {
  avatar_color?: string;
  emoji?: string;
  convenios?: string[];
  vet_24h_partner?: string;
  [k: string]: unknown;
}

export interface Tenant {
  id: string;
  name: string;
  packId: string;
  phone: string;
  address: string;
  hours: HoursMap;
  staff: StaffDTO[];
  services: ServiceDTO[];
  pixKey: string;
  googleReviewLink: string;
  settings: TenantSettings;
  createdAt: string;
}

export interface Contact {
  id: number;
  tenantId: string;
  waName: string;
  phone: string;
  memorySummary: string | null;
  optOut: boolean;
  profile: Record<string, string>;
  createdAt: string;
}

export interface Conversation {
  id: number;
  tenantId: string;
  contactId: number;
  status: ConvStatus;
  lastMsgAt: string | null;
  lowConfStreak: number;
  disclosed: boolean;
  pendingNote: string | null;
  createdAt: string;
}

export interface Message {
  id: number;
  conversationId: number;
  role: Role;
  type: MsgType;
  text: string | null;
  transcript: string | null;
  mediaPath: string | null;
  latencyMs: number | null;
  status: MsgStatus;
  meta: MessageMeta & Record<string, unknown>;
  createdAt: string;
}

export interface Appointment {
  id: number;
  tenantId: string;
  contactId: number;
  service: string;
  staff: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  price: number | null;
  source: string;
  conversationId: number | null;
  createdAt: string;
}

export interface QuoteItem {
  service: string;
  qty: number;
  price: number;
}

export interface Quote {
  id: number;
  tenantId: string;
  contactId: number;
  conversationId: number | null;
  items: QuoteItem[];
  total: number;
  status: QuoteStatus;
  approvalMessageId: number | null;
  createdAt: string;
}

export type ReminderKind = 'confirm_24h' | 'confirm_2h' | 'reactivation';

export interface Reminder {
  id: number;
  appointmentId: number | null;
  tenantId: string;
  contactId: number;
  fireAt: string;
  kind: ReminderKind;
  sent: boolean;
  sentAt: string | null;
  response: string | null;
  createdAt: string;
}

export interface Escalation {
  id: number;
  conversationId: number;
  reason: string;
  createdAt: string;
  resolved: boolean;
}

export interface EventRow {
  id: number;
  tenantId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const mapTenant = (r: Row): Tenant => ({
  id: r.id,
  name: r.name,
  packId: r.pack_id,
  phone: r.phone,
  address: r.address,
  hours: safeJson<HoursMap>(r.hours_json, {} as HoursMap),
  staff: safeJson<StaffDTO[]>(r.staff_json, []),
  services: safeJson<ServiceDTO[]>(r.services_json, []),
  pixKey: r.pix_key,
  googleReviewLink: r.google_review_link,
  settings: safeJson<TenantSettings>(r.settings_json, {}),
  createdAt: r.created_at,
});

const mapContact = (r: Row): Contact => ({
  id: Number(r.id),
  tenantId: r.tenant_id,
  waName: r.wa_name,
  phone: r.phone,
  memorySummary: r.memory_summary ?? null,
  optOut: !!r.opt_out,
  profile: safeJson<Record<string, string>>(r.profile_json, {}),
  createdAt: r.created_at,
});

const mapConversation = (r: Row): Conversation => ({
  id: Number(r.id),
  tenantId: r.tenant_id,
  contactId: Number(r.contact_id),
  status: r.status,
  lastMsgAt: r.last_msg_at ?? null,
  lowConfStreak: Number(r.low_conf_streak ?? 0),
  disclosed: !!r.disclosed,
  pendingNote: r.pending_note ?? null,
  createdAt: r.created_at,
});

const mapMessage = (r: Row): Message => ({
  id: Number(r.id),
  conversationId: Number(r.conversation_id),
  role: r.role,
  type: r.type,
  text: r.text ?? null,
  transcript: r.transcript ?? null,
  mediaPath: r.media_path ?? null,
  latencyMs: r.latency_ms === null || r.latency_ms === undefined ? null : Number(r.latency_ms),
  status: r.status,
  meta: safeJson(r.meta_json, {}),
  createdAt: r.created_at,
});

const mapAppointment = (r: Row): Appointment => ({
  id: Number(r.id),
  tenantId: r.tenant_id,
  contactId: Number(r.contact_id),
  service: r.service,
  staff: r.staff ?? null,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  status: r.status,
  price: r.price === null || r.price === undefined ? null : Number(r.price),
  source: r.source,
  conversationId: r.conversation_id === null || r.conversation_id === undefined ? null : Number(r.conversation_id),
  createdAt: r.created_at,
});

const mapQuote = (r: Row): Quote => ({
  id: Number(r.id),
  tenantId: r.tenant_id,
  contactId: Number(r.contact_id),
  conversationId: r.conversation_id === null || r.conversation_id === undefined ? null : Number(r.conversation_id),
  items: safeJson<QuoteItem[]>(r.items_json, []),
  total: Number(r.total),
  status: r.status,
  approvalMessageId:
    r.approval_message_id === null || r.approval_message_id === undefined ? null : Number(r.approval_message_id),
  createdAt: r.created_at,
});

const mapReminder = (r: Row): Reminder => ({
  id: Number(r.id),
  appointmentId: r.appointment_id === null || r.appointment_id === undefined ? null : Number(r.appointment_id),
  tenantId: r.tenant_id,
  contactId: Number(r.contact_id),
  fireAt: r.fire_at,
  kind: r.kind,
  sent: !!r.sent,
  sentAt: r.sent_at ?? null,
  response: r.response ?? null,
  createdAt: r.created_at,
});

const mapEscalation = (r: Row): Escalation => ({
  id: Number(r.id),
  conversationId: Number(r.conversation_id),
  reason: r.reason,
  createdAt: r.created_at,
  resolved: !!r.resolved,
});

const mapEvent = (r: Row): EventRow => ({
  id: Number(r.id),
  tenantId: r.tenant_id ?? null,
  kind: r.kind,
  payload: safeJson(r.payload_json, {}),
  createdAt: r.created_at,
});

export class Repo {
  readonly db: DB;
  readonly clock: Clock;

  constructor(db: DB, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  private now(): string {
    return this.clock.nowIso();
  }

  private one(sql: string, ...params: SqlVal[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  private all(sql: string, ...params: SqlVal[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  private run(sql: string, ...params: SqlVal[]): number {
    const res = this.db.prepare(sql).run(...params);
    return Number(res.lastInsertRowid);
  }

  // ---------- tenants ----------
  insertTenant(t: Omit<Tenant, 'createdAt'>): Tenant {
    this.run(
      `INSERT INTO tenants (id, name, pack_id, phone, address, hours_json, staff_json, services_json, pix_key, google_review_link, settings_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t.id,
      t.name,
      t.packId,
      t.phone,
      t.address,
      JSON.stringify(t.hours),
      JSON.stringify(t.staff),
      JSON.stringify(t.services),
      t.pixKey,
      t.googleReviewLink,
      JSON.stringify(t.settings ?? {}),
      this.now(),
    );
    return this.getTenant(t.id)!;
  }

  getTenant(id: string): Tenant | null {
    const r = this.one('SELECT * FROM tenants WHERE id = ?', id);
    return r ? mapTenant(r) : null;
  }

  listTenants(): Tenant[] {
    return this.all('SELECT * FROM tenants ORDER BY rowid').map(mapTenant);
  }

  countTenants(): number {
    return Number(this.one('SELECT COUNT(*) AS n FROM tenants')!.n);
  }

  // ---------- contacts ----------
  upsertContact(tenantId: string, phone: string, waName: string): Contact {
    const existing = this.one('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?', tenantId, phone);
    if (existing) {
      if (waName && existing.wa_name !== waName) {
        this.run('UPDATE contacts SET wa_name = ? WHERE id = ?', waName, existing.id);
        existing.wa_name = waName;
      }
      return mapContact(existing);
    }
    const id = this.run(
      'INSERT INTO contacts (tenant_id, wa_name, phone, created_at) VALUES (?, ?, ?, ?)',
      tenantId,
      waName || phone,
      phone,
      this.now(),
    );
    return this.getContact(id)!;
  }

  findContact(tenantId: string, phone: string): Contact | null {
    const r = this.one('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?', tenantId, phone);
    return r ? mapContact(r) : null;
  }

  getContact(id: number): Contact | null {
    const r = this.one('SELECT * FROM contacts WHERE id = ?', id);
    return r ? mapContact(r) : null;
  }

  listContacts(tenantId: string): Contact[] {
    return this.all('SELECT * FROM contacts WHERE tenant_id = ? ORDER BY id', tenantId).map(mapContact);
  }

  mergeContactProfile(id: number, patch: Record<string, string>): Contact {
    const c = this.getContact(id);
    if (!c) throw new Error(`contact ${id} not found`);
    const profile = { ...c.profile };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') profile[k] = String(v).trim();
    }
    this.run('UPDATE contacts SET profile_json = ? WHERE id = ?', JSON.stringify(profile), id);
    return this.getContact(id)!;
  }

  setContactName(id: number, name: string): void {
    this.run('UPDATE contacts SET wa_name = ? WHERE id = ?', name, id);
  }

  setOptOut(id: number, optOut: boolean): void {
    this.run('UPDATE contacts SET opt_out = ? WHERE id = ?', optOut ? 1 : 0, id);
  }

  setMemorySummary(id: number, summary: string | null): void {
    this.run('UPDATE contacts SET memory_summary = ? WHERE id = ?', summary, id);
  }

  /** LGPD erasure: delete the contact and everything that references it. */
  wipeContact(id: number): void {
    const c = this.getContact(id);
    if (!c) return;
    this.db.exec('BEGIN');
    try {
      const convIds = this.all('SELECT id FROM conversations WHERE contact_id = ?', id).map((r) => Number(r.id));
      for (const cid of convIds) {
        this.run(`DELETE FROM events WHERE json_extract(payload_json, '$.conversation_id') = ?`, cid);
      }
      this.run(`DELETE FROM events WHERE json_extract(payload_json, '$.contact_id') = ?`, id);
      this.run('DELETE FROM contacts WHERE id = ?', id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------- conversations ----------
  getOrCreateConversation(tenantId: string, contactId: number): Conversation {
    const r = this.one(
      'SELECT * FROM conversations WHERE tenant_id = ? AND contact_id = ? ORDER BY id DESC LIMIT 1',
      tenantId,
      contactId,
    );
    if (r) return mapConversation(r);
    const id = this.run(
      'INSERT INTO conversations (tenant_id, contact_id, status, created_at) VALUES (?, ?, ?, ?)',
      tenantId,
      contactId,
      'bot',
      this.now(),
    );
    return this.getConversation(id)!;
  }

  getConversation(id: number): Conversation | null {
    const r = this.one('SELECT * FROM conversations WHERE id = ?', id);
    return r ? mapConversation(r) : null;
  }

  listConversations(tenantId: string): Conversation[] {
    return this.all(
      `SELECT * FROM conversations WHERE tenant_id = ?
       ORDER BY COALESCE(last_msg_at, created_at) DESC, id DESC`,
      tenantId,
    ).map(mapConversation);
  }

  setConversationStatus(id: number, status: ConvStatus): void {
    this.run('UPDATE conversations SET status = ? WHERE id = ?', status, id);
  }

  setLowConfStreak(id: number, n: number): void {
    this.run('UPDATE conversations SET low_conf_streak = ? WHERE id = ?', n, id);
  }

  setDisclosed(id: number): void {
    this.run('UPDATE conversations SET disclosed = 1 WHERE id = ?', id);
  }

  setPendingNote(id: number, note: string | null): void {
    this.run('UPDATE conversations SET pending_note = ? WHERE id = ?', note, id);
  }

  // ---------- messages ----------
  insertMessage(m: {
    conversationId: number;
    role: Role;
    type?: MsgType;
    text?: string | null;
    transcript?: string | null;
    mediaPath?: string | null;
    latencyMs?: number | null;
    status?: MsgStatus;
    meta?: Record<string, unknown>;
    createdAt?: string;
  }): Message {
    const createdAt = m.createdAt ?? this.now();
    const id = this.run(
      `INSERT INTO messages (conversation_id, role, type, text, transcript, media_path, latency_ms, status, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.conversationId,
      m.role,
      m.type ?? 'text',
      m.text ?? null,
      m.transcript ?? null,
      m.mediaPath ?? null,
      m.latencyMs ?? null,
      m.status ?? 'sent',
      JSON.stringify(m.meta ?? {}),
      createdAt,
    );
    this.run('UPDATE conversations SET last_msg_at = ? WHERE id = ?', createdAt, m.conversationId);
    return this.getMessage(id)!;
  }

  getMessage(id: number): Message | null {
    const r = this.one('SELECT * FROM messages WHERE id = ?', id);
    return r ? mapMessage(r) : null;
  }

  updateMessage(
    id: number,
    patch: Partial<Pick<Message, 'text' | 'transcript' | 'status' | 'latencyMs'>> & { meta?: Record<string, unknown> },
  ): Message {
    const cur = this.getMessage(id);
    if (!cur) throw new Error(`message ${id} not found`);
    const meta = patch.meta ? { ...cur.meta, ...patch.meta } : cur.meta;
    this.run(
      'UPDATE messages SET text = ?, transcript = ?, status = ?, latency_ms = ?, meta_json = ? WHERE id = ?',
      patch.text !== undefined ? patch.text : cur.text,
      patch.transcript !== undefined ? patch.transcript : cur.transcript,
      patch.status ?? cur.status,
      patch.latencyMs !== undefined ? patch.latencyMs : cur.latencyMs,
      JSON.stringify(meta),
      id,
    );
    return this.getMessage(id)!;
  }

  listMessages(conversationId: number): Message[] {
    return this.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', conversationId).map(mapMessage);
  }

  recentMessages(conversationId: number, n: number): Message[] {
    return this.all(
      'SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id',
      conversationId,
      n,
    ).map(mapMessage);
  }

  lastMessage(conversationId: number): Message | null {
    const r = this.one('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', conversationId);
    return r ? mapMessage(r) : null;
  }

  markCustomerMessagesRead(conversationId: number): Message[] {
    const unread = this.all(
      `SELECT * FROM messages WHERE conversation_id = ? AND role = 'customer' AND status != 'read'`,
      conversationId,
    ).map(mapMessage);
    this.run(`UPDATE messages SET status = 'read' WHERE conversation_id = ? AND role = 'customer'`, conversationId);
    return unread.map((m) => ({ ...m, status: 'read' as const }));
  }

  // ---------- appointments ----------
  insertAppointment(a: {
    tenantId: string;
    contactId: number;
    service: string;
    staff: string | null;
    startsAt: string;
    endsAt: string;
    status?: AppointmentStatus;
    price?: number | null;
    source?: string;
    conversationId?: number | null;
    createdAt?: string;
  }): Appointment {
    const id = this.run(
      `INSERT INTO appointments (tenant_id, contact_id, service, staff, starts_at, ends_at, status, price, source, conversation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.tenantId,
      a.contactId,
      a.service,
      a.staff,
      a.startsAt,
      a.endsAt,
      a.status ?? 'booked',
      a.price ?? null,
      a.source ?? 'bot',
      a.conversationId ?? null,
      a.createdAt ?? this.now(),
    );
    return this.getAppointment(id)!;
  }

  getAppointment(id: number): Appointment | null {
    const r = this.one('SELECT * FROM appointments WHERE id = ?', id);
    return r ? mapAppointment(r) : null;
  }

  updateAppointment(id: number, patch: Partial<Pick<Appointment, 'status' | 'startsAt' | 'endsAt' | 'staff'>>): Appointment {
    const cur = this.getAppointment(id);
    if (!cur) throw new Error(`appointment ${id} not found`);
    this.run(
      'UPDATE appointments SET status = ?, starts_at = ?, ends_at = ?, staff = ? WHERE id = ?',
      patch.status ?? cur.status,
      patch.startsAt ?? cur.startsAt,
      patch.endsAt ?? cur.endsAt,
      patch.staff !== undefined ? patch.staff : cur.staff,
      id,
    );
    return this.getAppointment(id)!;
  }

  appointmentsForContact(contactId: number): Appointment[] {
    return this.all('SELECT * FROM appointments WHERE contact_id = ? ORDER BY starts_at', contactId).map(mapAppointment);
  }

  /** Active (booked/confirmed) appointments overlapping [from, to). */
  activeAppointmentsBetween(tenantId: string, fromIso: string, toIso: string): Appointment[] {
    return this.all(
      `SELECT * FROM appointments WHERE tenant_id = ? AND status IN ('booked', 'confirmed')
       AND starts_at < ? AND ends_at > ? ORDER BY starts_at`,
      tenantId,
      toIso,
      fromIso,
    ).map(mapAppointment);
  }

  appointmentsForTenant(tenantId: string): Appointment[] {
    return this.all('SELECT * FROM appointments WHERE tenant_id = ? ORDER BY starts_at', tenantId).map(mapAppointment);
  }

  // ---------- quotes ----------
  insertQuote(q: { tenantId: string; contactId: number; conversationId: number | null; items: QuoteItem[]; total: number }): Quote {
    const id = this.run(
      `INSERT INTO quotes (tenant_id, contact_id, conversation_id, items_json, total, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'sent', ?)`,
      q.tenantId,
      q.contactId,
      q.conversationId,
      JSON.stringify(q.items),
      q.total,
      this.now(),
    );
    return this.getQuote(id)!;
  }

  getQuote(id: number): Quote | null {
    const r = this.one('SELECT * FROM quotes WHERE id = ?', id);
    return r ? mapQuote(r) : null;
  }

  quotesForContact(contactId: number): Quote[] {
    return this.all('SELECT * FROM quotes WHERE contact_id = ? ORDER BY id', contactId).map(mapQuote);
  }

  quotesForConversation(conversationId: number): Quote[] {
    return this.all('SELECT * FROM quotes WHERE conversation_id = ? ORDER BY id', conversationId).map(mapQuote);
  }

  setQuoteStatus(id: number, status: QuoteStatus, approvalMessageId: number | null = null): Quote {
    this.run('UPDATE quotes SET status = ?, approval_message_id = ? WHERE id = ?', status, approvalMessageId, id);
    return this.getQuote(id)!;
  }

  // ---------- reminders ----------
  insertReminder(r: {
    appointmentId: number | null;
    tenantId: string;
    contactId: number;
    fireAt: string;
    kind: ReminderKind;
    sent?: boolean;
    sentAt?: string | null;
    response?: string | null;
  }): Reminder {
    const id = this.run(
      `INSERT INTO reminders (appointment_id, tenant_id, contact_id, fire_at, kind, sent, sent_at, response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.appointmentId,
      r.tenantId,
      r.contactId,
      r.fireAt,
      r.kind,
      r.sent ? 1 : 0,
      r.sentAt ?? null,
      r.response ?? null,
      this.now(),
    );
    return this.getReminder(id)!;
  }

  getReminder(id: number): Reminder | null {
    const r = this.one('SELECT * FROM reminders WHERE id = ?', id);
    return r ? mapReminder(r) : null;
  }

  dueReminders(nowIso: string): Reminder[] {
    return this.all('SELECT * FROM reminders WHERE sent = 0 AND fire_at <= ? ORDER BY fire_at', nowIso).map(mapReminder);
  }

  remindersForAppointment(appointmentId: number): Reminder[] {
    return this.all('SELECT * FROM reminders WHERE appointment_id = ? ORDER BY fire_at', appointmentId).map(mapReminder);
  }

  remindersForContact(contactId: number): Reminder[] {
    return this.all('SELECT * FROM reminders WHERE contact_id = ? ORDER BY fire_at', contactId).map(mapReminder);
  }

  markReminderSent(id: number): void {
    this.run('UPDATE reminders SET sent = 1, sent_at = ? WHERE id = ?', this.now(), id);
  }

  setReminderResponse(id: number, response: string): void {
    this.run('UPDATE reminders SET response = ? WHERE id = ?', response, id);
  }

  deleteUnsentReminders(appointmentId: number): void {
    this.run('DELETE FROM reminders WHERE appointment_id = ? AND sent = 0', appointmentId);
  }

  /** Latest sent confirm reminder for this contact still awaiting a 1/2 answer. */
  awaitingConfirmReminder(contactId: number): Reminder | null {
    const r = this.one(
      `SELECT * FROM reminders WHERE contact_id = ? AND sent = 1 AND response IS NULL
       AND kind IN ('confirm_24h', 'confirm_2h') ORDER BY sent_at DESC LIMIT 1`,
      contactId,
    );
    return r ? mapReminder(r) : null;
  }

  // ---------- escalations ----------
  insertEscalation(conversationId: number, reason: string): Escalation {
    const id = this.run(
      'INSERT INTO escalations (conversation_id, reason, created_at) VALUES (?, ?, ?)',
      conversationId,
      reason,
      this.now(),
    );
    return mapEscalation(this.one('SELECT * FROM escalations WHERE id = ?', id)!);
  }

  getEscalation(id: number): Escalation | null {
    const r = this.one('SELECT * FROM escalations WHERE id = ?', id);
    return r ? mapEscalation(r) : null;
  }

  openEscalations(conversationId: number): Escalation[] {
    return this.all('SELECT * FROM escalations WHERE conversation_id = ? AND resolved = 0 ORDER BY id', conversationId).map(
      mapEscalation,
    );
  }

  escalationsForConversation(conversationId: number): Escalation[] {
    return this.all('SELECT * FROM escalations WHERE conversation_id = ? ORDER BY id', conversationId).map(mapEscalation);
  }

  resolveEscalation(id: number): void {
    this.run('UPDATE escalations SET resolved = 1 WHERE id = ?', id);
  }

  resolveAllEscalations(conversationId: number): void {
    this.run('UPDATE escalations SET resolved = 1 WHERE conversation_id = ?', conversationId);
  }

  // ---------- events ----------
  logEvent(tenantId: string | null, kind: string, payload: Record<string, unknown> = {}): void {
    this.run(
      'INSERT INTO events (tenant_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)',
      tenantId,
      kind,
      JSON.stringify(payload),
      this.now(),
    );
  }

  events(filter: { tenantId?: string | null; kind?: string; conversationId?: number; since?: string } = {}): EventRow[] {
    const where: string[] = [];
    const params: SqlVal[] = [];
    if (filter.tenantId) {
      where.push('tenant_id = ?');
      params.push(filter.tenantId);
    }
    if (filter.kind) {
      where.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.conversationId !== undefined) {
      where.push(`json_extract(payload_json, '$.conversation_id') = ?`);
      params.push(filter.conversationId);
    }
    if (filter.since) {
      where.push('created_at >= ?');
      params.push(filter.since);
    }
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`;
    return this.all(sql, ...params).map(mapEvent);
  }

  /** Raw query escape hatch for reports. */
  query(sql: string, ...params: SqlVal[]): Row[] {
    return this.all(sql, ...params);
  }

  // ---------- DTO mapping ----------
  tenantDTO(t: Tenant): TenantDTO {
    let packName = t.packId;
    try {
      packName = getPack(t.packId).name;
    } catch {
      /* unknown pack: keep id */
    }
    return {
      id: t.id,
      name: t.name,
      packId: t.packId,
      packName,
      phone: t.phone,
      address: t.address,
      hours: t.hours,
      staff: t.staff,
      services: t.services,
      pixKey: t.pixKey,
      googleReviewLink: t.googleReviewLink,
      avatarColor: (t.settings.avatar_color as string) ?? '#00a884',
      emoji: (t.settings.emoji as string) ?? '💬',
    };
  }

  messageDTO(m: Message): MessageDTO {
    return {
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      type: m.type,
      text: m.text,
      transcript: m.transcript,
      mediaUrl: m.mediaPath ? `/media/${m.mediaPath}` : null,
      latencyMs: m.latencyMs,
      status: m.status,
      createdAt: m.createdAt,
      meta: {
        simulatedAudio: m.meta.simulatedAudio as boolean | undefined,
        imageDescription: m.meta.imageDescription as string | undefined,
        guard: m.meta.guard as boolean | undefined,
        tools: m.meta.tools as string[] | undefined,
        kind: m.meta.kind as string | undefined,
        durationS: m.meta.durationS as number | undefined,
        error: m.meta.error as string | undefined,
      },
    };
  }

  contactDTO(c: Contact): ContactDTO {
    return {
      id: c.id,
      waName: c.waName,
      phone: c.phone,
      memorySummary: c.memorySummary,
      optOut: c.optOut,
      profile: c.profile,
    };
  }

  escalationDTO(e: Escalation): EscalationDTO {
    return { ...e };
  }

  conversationDTO(c: Conversation): ConversationDTO {
    const contact = this.getContact(c.contactId);
    const last = this.lastMessage(c.id);
    return {
      id: c.id,
      tenantId: c.tenantId,
      contact: contact
        ? this.contactDTO(contact)
        : { id: c.contactId, waName: '(apagado)', phone: '', memorySummary: null, optOut: false, profile: {} },
      status: c.status,
      lastMsgAt: c.lastMsgAt,
      lastMessage: last ? this.messageDTO(last) : null,
      openEscalations: this.openEscalations(c.id).map((e) => this.escalationDTO(e)),
    };
  }

  appointmentDTO(a: Appointment): AppointmentDTO {
    return {
      id: a.id,
      tenantId: a.tenantId,
      contactId: a.contactId,
      service: a.service,
      staff: a.staff,
      startsAt: a.startsAt,
      status: a.status,
      price: a.price,
    };
  }

  quoteDTO(q: Quote): QuoteDTO {
    return {
      id: q.id,
      tenantId: q.tenantId,
      contactId: q.contactId,
      items: q.items,
      total: q.total,
      status: q.status,
      approvalMessageId: q.approvalMessageId,
      createdAt: q.createdAt,
    };
  }
}
