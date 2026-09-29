// Conversation engine: inbound message -> policies -> LLM tool loop -> guard -> send.

import path from 'node:path';
import type { Repo, Tenant, Contact, Conversation, Message, Appointment, Reminder } from '../db/repo.ts';
import type { Channel, InboundMessage } from '../channels/channel.ts';
import type { EventHub } from '../channels/hub.ts';
import type { MediaService } from '../media/media.ts';
import type { ChatMessage, LLM } from './llm.ts';
import { parseTextToolCalls } from './llm.ts';
import { getPack, type Pack } from '../packs/packs.ts';
import { composeMessages, personaFor, type PromptContext } from './prompt.ts';
import { TOOL_NAMES, TOOL_SPECS, executeTool, type ToolCallRecord, type ToolContext } from './tools.ts';
import { GUARD_REPLY, asksAboutPrice, checkPrices, stripPriceSentences, type GuardContext } from './guard.ts';
import {
  isAngry,
  isComplaint,
  promisesHandoff,
  isHumanRequest,
  isLgpdErase,
  isOptIn,
  isOptOut,
  isSpam,
  looksLowConfidence,
  quoteDecision,
  reminderAnswer,
  sensitiveTopic,
} from './policy.ts';
import { norm, stripDashes, stripThink, formatBRL } from '../util/text.ts';
import { formatSlotPt, isOpenAt, type Clock } from '../util/time.ts';
import * as templates from './templates.ts';

export interface EngineOptions {
  model: string;
  maxToolRounds?: number;
  temperature?: number;
  numPredict?: number;
  mediaDir?: string;
}

export interface TurnResult {
  conversationId: number;
  customerMessageIds: number[];
  reply: Message | null;
  toolCalls: ToolCallRecord[];
  escalated: boolean;
  guardTriggered: boolean;
  lowConfidence: boolean;
  latencyMs: number | null;
  rawText?: string;
  skipped?: string;
  error?: string;
}

export interface InboundResult {
  message: Message;
  conversation: Conversation;
  done: Promise<TurnResult>;
}

const ACTION_CLAIM = /\b(agendad[oa]s?|marcad[oa]s?|reservad[oa]s?|remarcad[oa]s?|cancelad[oa]s?)\b/;

export class Engine {
  readonly repo: Repo;
  readonly clock: Clock;
  readonly llm: LLM;
  readonly hub: EventHub;
  readonly channel: Channel;
  readonly media: MediaService | null;
  readonly opts: Required<Omit<EngineOptions, 'mediaDir'>> & { mediaDir: string };
  private locks = new Map<number, Promise<unknown>>();
  private receivedAt = new Map<number, number>();

  constructor(deps: {
    repo: Repo;
    clock: Clock;
    llm: LLM;
    hub: EventHub;
    channel: Channel;
    media?: MediaService | null;
    options: EngineOptions;
  }) {
    this.repo = deps.repo;
    this.clock = deps.clock;
    this.llm = deps.llm;
    this.hub = deps.hub;
    this.channel = deps.channel;
    this.media = deps.media ?? null;
    this.opts = {
      maxToolRounds: 4,
      temperature: 0.3,
      numPredict: 350,
      mediaDir: 'data/media',
      ...deps.options,
    };
    this.channel.onMessage((msg) => this.handleInbound(msg));
  }

  // ------------------------------------------------------------------ helpers

  private withLock<T>(conversationId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(conversationId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      conversationId,
      next.catch(() => undefined),
    );
    return next;
  }

  /** Wait until all queued work for a conversation has finished. */
  async idle(conversationId: number): Promise<void> {
    await (this.locks.get(conversationId) ?? Promise.resolve());
  }

  private emitMessage(tenantId: string, msg: Message, kind: 'created' | 'updated'): void {
    this.hub.emit({
      type: kind === 'created' ? 'message.created' : 'message.updated',
      tenantId,
      conversationId: msg.conversationId,
      message: this.repo.messageDTO(msg),
    });
  }

  emitConversation(conversationId: number): void {
    const c = this.repo.getConversation(conversationId);
    if (c) this.hub.emit({ type: 'conversation.updated', tenantId: c.tenantId, conversation: this.repo.conversationDTO(c) });
  }

  private tenantAndPack(tenantId: string): { tenant: Tenant; pack: Pack } {
    const tenant = this.repo.getTenant(tenantId);
    if (!tenant) throw new Error(`unknown tenant ${tenantId}`);
    return { tenant, pack: getPack(tenant.packId) };
  }

  private ref(conv: Conversation, contact: Contact) {
    return { tenantId: conv.tenantId, phone: contact.phone, conversationId: conv.id };
  }

  introFor(pack: Pack, tenant: Tenant): string {
    const m = pack.persona_pt.match(/^(o|a)\s+(\S+)/i);
    const art = m?.[1]?.toLowerCase() ?? 'o';
    const noun = m?.[2] ?? 'assistente';
    const prep = (tenant.settings.preposition as string | undefined) ?? 'de';
    return `Eu sou ${art} ${noun} virtual ${prep} ${tenant.name}.`;
  }

  /** Rule 5: disclose once, on first contact, that this is a virtual assistant. */
  ensureDisclosure(text: string, conv: Conversation, pack: Pack, tenant: Tenant): string {
    if (conv.disclosed || /\bvirtual\b/i.test(text)) return text;
    const intro = this.introFor(pack, tenant);
    const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    // Greeting word(s) plus an optional capitalized name: "Oi!", "Boa noite, Carla!"
    const GREET = /^((?:[Oo]i|[Oo]l\u00e1|[Oo]la|[Oo]pa|[Bb]om dia|[Bb]oa tarde|[Bb]oa noite|[Ee] a[i\u00ed])(?:,?\s+[A-Z\u00c0-\u00dd][a-z\u00e0-\u00ff]+)?\s*[!.,]?)\s*/;
    let greeting = 'Oi!';
    let rest = text.trim();
    const g = rest.match(GREET);
    if (g) {
      greeting = g[1].trim().replace(/[,.]$/, '') + (/[!]$/.test(g[1].trim()) ? '' : '!');
      rest = rest.slice(g[0].length);
    }
    // Replace a model-written self introduction ("sou a Essenza...") with the canonical one.
    const first = rest.match(/^[^.!?\n]*[.!?]?\s*/)?.[0] ?? '';
    if (/\b(sou|aqui (?:\u00e9|e)|me chamo|falo d[ao])\b/i.test(first)) rest = rest.slice(first.length);
    return `${greeting} ${intro} ${cap(rest.trim())}`.trim();
  }

  // ------------------------------------------------------------------ inbound

  async handleInbound(msg: InboundMessage): Promise<InboundResult> {
    const { tenant } = this.tenantAndPack(msg.tenantId);
    const contact = this.repo.upsertContact(tenant.id, msg.phone, msg.name);
    const conv = this.repo.getOrCreateConversation(tenant.id, contact.id);
    const meta: Record<string, unknown> = {};
    if (msg.durationS) meta.durationS = msg.durationS;
    let transcript: string | null = null;
    if (msg.type === 'audio' && msg.simulatedTranscript !== undefined) {
      transcript = msg.simulatedTranscript;
      meta.simulatedAudio = true;
    }
    if (msg.type === 'image' && msg.imageDescription) meta.imageDescription = msg.imageDescription;
    if (!isOpenAt(tenant.hours, this.clock.now())) meta.afterHours = true;
    const saved = this.repo.insertMessage({
      conversationId: conv.id,
      role: 'customer',
      type: msg.type,
      text: msg.type === 'audio' ? null : (msg.text ?? null),
      transcript,
      mediaPath: msg.mediaPath ?? null,
      status: 'delivered',
      meta,
    });
    this.receivedAt.set(saved.id, Date.now());
    this.repo.logEvent(tenant.id, 'message_in', {
      conversation_id: conv.id,
      contact_id: contact.id,
      message_id: saved.id,
      type: msg.type,
      after_hours: !!meta.afterHours,
    });
    this.emitMessage(tenant.id, saved, 'created');
    this.emitConversation(conv.id);
    const done = this.withLock(conv.id, () => this.processConversation(conv.id));
    return { message: saved, conversation: this.repo.getConversation(conv.id)!, done };
  }

  // ------------------------------------------------------------------ processing

  private async processConversation(convId: number): Promise<TurnResult> {
    const conv0 = this.repo.getConversation(convId);
    const empty: TurnResult = {
      conversationId: convId,
      customerMessageIds: [],
      reply: null,
      toolCalls: [],
      escalated: false,
      guardTriggered: false,
      lowConfidence: false,
      latencyMs: null,
    };
    if (!conv0) return { ...empty, skipped: 'gone' };
    const recent = this.repo.recentMessages(convId, 40);
    let lastOther = -1;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i].role !== 'customer') {
        lastOther = i;
        break;
      }
    }
    let pending = recent.slice(lastOther + 1).filter((m) => m.role === 'customer');
    if (pending.length === 0) return { ...empty, skipped: 'nothing-pending' };
    const { tenant, pack } = this.tenantAndPack(conv0.tenantId);
    const contact = this.repo.getContact(conv0.contactId)!;
    const ref = this.ref(conv0, contact);
    const botActive = conv0.status !== 'human';

    if (botActive) {
      const read = this.repo.markCustomerMessagesRead(convId);
      for (const m of read) this.emitMessage(tenant.id, m, 'updated');
      await this.channel.markRead(ref, read.map((m) => m.id));
      await this.channel.typing(ref, true);
    }
    try {
      for (const m of pending) await this.enrich(tenant, m);
      pending = pending.map((m) => this.repo.getMessage(m.id)!);
      const conv = this.repo.getConversation(convId)!;
      if (conv.status === 'human') {
        this.emitConversation(convId);
        return { ...empty, customerMessageIds: pending.map((m) => m.id), skipped: 'human' };
      }
      return await this.respond(conv, tenant, pack, contact, pending);
    } finally {
      if (botActive) await this.channel.typing(ref, false);
    }
  }

  /** Fill in transcripts (whisperX) and image descriptions (vision) for customer media. */
  private async enrich(tenant: Tenant, m: Message): Promise<void> {
    if (m.type === 'audio' && m.transcript === null) {
      let transcript = '';
      const meta: Record<string, unknown> = {};
      try {
        if (!this.media || !m.mediaPath) throw new Error('media service unavailable');
        const abs = path.resolve(this.opts.mediaDir, m.mediaPath);
        const t = await this.media.transcribe(abs);
        transcript = t.text || '(audio sem fala reconhecivel)';
        if (!m.meta.durationS && t.durationS) meta.durationS = t.durationS;
      } catch (err) {
        transcript = '(nao foi possivel transcrever o audio)';
        meta.error = (err as Error).message.slice(0, 300);
        this.repo.logEvent(tenant.id, 'transcription_failed', { conversation_id: m.conversationId, error: meta.error });
      }
      const updated = this.repo.updateMessage(m.id, { transcript, meta });
      this.emitMessage(tenant.id, updated, 'updated');
    }
    if (m.type === 'image' && !m.meta.imageDescription) {
      let description = '';
      const meta: Record<string, unknown> = {};
      try {
        if (!this.media || !m.mediaPath) throw new Error('media service unavailable');
        description = await this.media.describeImage(path.resolve(this.opts.mediaDir, m.mediaPath));
      } catch (err) {
        description = 'imagem (nao foi possivel descrever)';
        meta.error = (err as Error).message.slice(0, 300);
      }
      meta.imageDescription = description || 'imagem';
      const updated = this.repo.updateMessage(m.id, { meta });
      this.emitMessage(tenant.id, updated, 'updated');
    }
  }

  private customerText(m: Message): string {
    if (m.type === 'audio') return m.transcript ?? '';
    if (m.type === 'image') return `[foto: ${(m.meta.imageDescription as string) ?? 'imagem'}]${m.text ? ' ' + m.text : ''}`;
    return m.text ?? '';
  }

  private latencyFor(pending: Message[]): number | null {
    const first = pending[0];
    if (!first) return null;
    const t0 = this.receivedAt.get(first.id);
    for (const m of pending) this.receivedAt.delete(m.id);
    return t0 ? Date.now() - t0 : null;
  }

  async sendAssistant(
    conv: Conversation,
    text: string,
    meta: Record<string, unknown> = {},
    latencyMs: number | null = null,
  ): Promise<Message> {
    const { tenant, pack } = this.tenantAndPack(conv.tenantId);
    const contact = this.repo.getContact(conv.contactId)!;
    const fresh = this.repo.getConversation(conv.id)!;
    const finalText = this.ensureDisclosure(stripDashes(text).trim(), fresh, pack, tenant);
    const msg = this.repo.insertMessage({
      conversationId: conv.id,
      role: 'assistant',
      text: finalText,
      latencyMs,
      status: 'sent',
      meta,
    });
    if (!fresh.disclosed) this.repo.setDisclosed(conv.id);
    this.emitMessage(tenant.id, msg, 'created');
    await this.channel.send(this.ref(fresh, contact), { kind: 'text', text: finalText });
    this.repo.logEvent(tenant.id, 'message_out', {
      conversation_id: conv.id,
      contact_id: contact.id,
      message_id: msg.id,
      latency_ms: latencyMs,
      kind: meta.kind ?? 'reply',
    });
    this.emitConversation(conv.id);
    return msg;
  }

  escalate(conv: Conversation, reason: string, source: string): number {
    const esc = this.repo.insertEscalation(conv.id, reason);
    this.repo.logEvent(conv.tenantId, 'escalation', {
      conversation_id: conv.id,
      contact_id: conv.contactId,
      escalation_id: esc.id,
      reason,
      source,
    });
    this.pause(conv.id, `escalation:${source}`);
    this.hub.emit({ type: 'escalation.created', tenantId: conv.tenantId, conversationId: conv.id, escalation: this.repo.escalationDTO(esc) });
    return esc.id;
  }

  private pause(convId: number, why: string): void {
    const c = this.repo.getConversation(convId);
    if (!c || c.status === 'human') return;
    this.repo.setConversationStatus(convId, 'human');
    this.repo.logEvent(c.tenantId, 'bot_paused', { conversation_id: convId, why });
    this.emitConversation(convId);
  }

  private async respond(conv: Conversation, tenant: Tenant, pack: Pack, contact: Contact, pending: Message[]): Promise<TurnResult> {
    const text = pending.map((m) => this.customerText(m)).join('\n').trim();
    const ids = pending.map((m) => m.id);
    const base: TurnResult = {
      conversationId: conv.id,
      customerMessageIds: ids,
      reply: null,
      toolCalls: [],
      escalated: false,
      guardTriggered: false,
      lowConfidence: false,
      latencyMs: null,
    };
    const send = async (reply: string, meta: Record<string, unknown> = {}) => {
      const latency = this.latencyFor(pending);
      const msg = await this.sendAssistant(conv, reply, meta, latency);
      return { msg, latency };
    };

    // --- closed (spam) conversations
    if (conv.status === 'closed') {
      if (isSpam(text)) return { ...base, skipped: 'spam-closed' };
      this.repo.setConversationStatus(conv.id, 'bot');
    }

    // --- LGPD erasure
    if (isLgpdErase(text)) {
      const name = contact.waName;
      this.repo.wipeContact(contact.id);
      this.repo.logEvent(tenant.id, 'lgpd_wipe', { at: this.clock.nowIso() });
      const freshContact = this.repo.upsertContact(tenant.id, contact.phone, name);
      const freshConv = this.repo.getOrCreateConversation(tenant.id, freshContact.id);
      this.repo.setDisclosed(freshConv.id);
      const msg = await this.sendAssistant(freshConv, templates.lgpdWiped(tenant), { kind: 'lgpd' }, this.latencyFor(pending));
      return { ...base, conversationId: freshConv.id, reply: msg, skipped: 'lgpd' };
    }

    // --- opt-out / opt-in
    if (isOptOut(text)) {
      this.repo.setOptOut(contact.id, true);
      this.repo.logEvent(tenant.id, 'opt_out', { contact_id: contact.id, conversation_id: conv.id });
      const { msg, latency } = await send(templates.optOut(), { kind: 'opt_out' });
      return { ...base, reply: msg, latencyMs: latency, skipped: 'opt_out' };
    }
    if (contact.optOut && isOptIn(text)) {
      this.repo.setOptOut(contact.id, false);
      const { msg, latency } = await send(templates.optIn(), { kind: 'opt_in' });
      return { ...base, reply: msg, latencyMs: latency, skipped: 'opt_in' };
    }

    // --- explicit request for a human
    if (isHumanRequest(text)) {
      const { msg, latency } = await send(templates.handoff(), { kind: 'handoff' });
      this.escalate(conv, 'cliente pediu atendimento humano', 'policy');
      return { ...base, reply: msg, latencyMs: latency, escalated: true, skipped: 'human_request' };
    }

    // --- spam
    if (isSpam(text)) {
      this.repo.logEvent(tenant.id, 'spam_detected', { conversation_id: conv.id });
      const { msg, latency } = await send(templates.spam(tenant), { kind: 'spam' });
      this.repo.setConversationStatus(conv.id, 'closed');
      this.emitConversation(conv.id);
      return { ...base, reply: msg, latencyMs: latency, skipped: 'spam' };
    }

    const notes: string[] = [];
    let forceEscalation: string | null = null;

    // --- reminder answers (1 confirms, 2 reschedules)
    const waiting = this.repo.awaitingConfirmReminder(contact.id);
    const answer = waiting ? reminderAnswer(text) : null;
    if (waiting && answer) {
      this.repo.setReminderResponse(waiting.id, answer);
      const appt = waiting.appointmentId ? this.repo.getAppointment(waiting.appointmentId) : null;
      if (answer === '1' && appt) {
        this.repo.updateAppointment(appt.id, { status: 'confirmed' });
        this.repo.logEvent(tenant.id, 'reminder_confirmed', { conversation_id: conv.id, appointment_id: appt.id, reminder_id: waiting.id });
        const { msg, latency } = await send(templates.confirmed(appt), { kind: 'reminder_confirmed' });
        return { ...base, reply: msg, latencyMs: latency, skipped: 'reminder_confirmed' };
      }
      if (answer === '2' && appt) {
        this.repo.logEvent(tenant.id, 'reminder_reschedule_requested', { conversation_id: conv.id, appointment_id: appt.id, reminder_id: waiting.id });
        notes.push(
          `O cliente respondeu 2 ao lembrete: quer REMARCAR o agendamento #${appt.id} (${appt.service}, ${formatSlotPt(new Date(appt.startsAt))}). ` +
            'Pergunte o melhor dia/periodo ou ofereca 2 horarios com check_availability; quando ele escolher, use reschedule.',
        );
      }
    }

    // --- quote approval (oficina rule: only clear approval counts)
    const openQuote = this.repo.quotesForContact(contact.id).filter((q) => q.status === 'sent').pop();
    if (openQuote) {
      const decision = quoteDecision(text);
      if (decision) {
        this.repo.setQuoteStatus(openQuote.id, decision, decision === 'approved' ? ids[ids.length - 1] : null);
        this.repo.logEvent(tenant.id, decision === 'approved' ? 'quote_approved' : 'quote_rejected', {
          conversation_id: conv.id,
          quote_id: openQuote.id,
          total: openQuote.total,
          message_id: ids[ids.length - 1],
        });
        notes.push(
          decision === 'approved'
            ? `O cliente APROVOU o orcamento #${openQuote.id} (${formatBRL(openQuote.total)}). Agradeca e confirme que o servico esta autorizado; se ainda nao houver horario, combine a data.`
            : `O cliente RECUSOU o orcamento #${openQuote.id}. Respeite a decisao, sem insistir, e se coloque a disposicao.`,
        );
      }
    }

    // --- sensitive topics and angry customers: always hand over after one safe reply
    const topic = sensitiveTopic(pack.id, text);
    if (topic) {
      // Deterministic safe reply: no clinical/technical advice can come from the model here.
      const { msg, latency } = await send(templates.sensitiveReply(pack.id, tenant), { kind: 'sensitive_handoff', topic });
      this.escalate(conv, `tema sensivel: ${topic}`, 'policy');
      return { ...base, reply: msg, latencyMs: latency, escalated: true, skipped: 'sensitive' };
    }
    if (isComplaint(text)) {
      forceEscalation = 'reclamacao de servico';
      notes.push('O cliente esta reclamando de um servico. Acolha, peca desculpas sem discutir nem justificar, nao faca perguntas de investigacao, e use escalate para a equipe assumir.');
    } else if (isAngry(text)) {
      forceEscalation = 'cliente insatisfeito/bravo';
      notes.push('O cliente esta insatisfeito. Acolha, peca desculpas sem discutir nem justificar, e use escalate para a equipe assumir.');
    }
    if (pending.some((m) => m.type === 'image')) {
      const clinical = ['odonto', 'pet', 'estetica', 'salao'].includes(pack.id);
      notes.push(
        clinical
          ? 'O cliente enviou uma FOTO. Nao avalie a foto, nao diga o que pode ser, nao sugira tratamento, procedimento, produto ou remedio. Diga com acolhimento que so a profissional pode avaliar presencialmente e ofereca agendar a avaliacao (ou consulta).'
          : 'O cliente enviou uma FOTO. Nao diagnostique com certeza e nao feche valor pela foto: explique que o valor fechado sai depois que o mecanico avaliar o carro e ofereca agendar a avaliacao/diagnostico da lista.',
      );
    }
    if (conv.pendingNote?.startsWith(PENDING_PREFIX)) {
      const action = JSON.parse(conv.pendingNote.slice(PENDING_PREFIX.length)) as PendingAction;
      this.repo.setPendingNote(conv.id, null);
      if (isAffirmative(text)) {
        // The system asked a yes/no confirmation; "yes" executes it (no model in the loop).
        const result = await executeTool(
          { repo: this.repo, clock: this.clock, tenant, pack, contact, conversation: conv },
          action.tool,
          action.args,
        );
        this.repo.logEvent(tenant.id, 'tool_call', { conversation_id: conv.id, name: action.tool, args: action.args, ok: result.ok, result, source: 'confirmation' });
        const calls = [{ name: action.tool, args: action.args, result }];
        if (result.ok) {
          const done =
            action.tool === 'cancel'
              ? 'Pronto, seu agendamento foi cancelado. Quando quiser remarcar, é só chamar!'
              : `Pronto! ${action.tool === 'reschedule' ? 'Remarcado' : 'Agendado'}: ${String(result.service ?? action.args.service ?? '')}, ${String(result.when ?? action.label)}${result.staff ? ` com ${String(result.staff)}` : ''}. Te mando um lembrete antes.`;
          const { msg, latency } = await send(done, { tools: [action.tool], kind: 'confirmation' });
          return { ...base, reply: msg, latencyMs: latency, toolCalls: calls as never, skipped: 'confirmed_action' };
        }
        notes.push(`A acao ${action.tool} falhou: ${String(result.error ?? '')}. Ofereca outras opcoes com check_availability.`);
      }
    } else if (conv.pendingNote) {
      notes.push(conv.pendingNote);
      this.repo.setPendingNote(conv.id, null);
    }

    // --- LLM tool loop
    const run = await this.runAssistant(conv, tenant, pack, contact, notes);
    let reply = run.text;
    const meta: Record<string, unknown> = { tools: run.calls.map((c) => c.name) };
    if (run.unverifiedClaim) {
      // Never tell the customer something was booked/cancelled when no tool did it.
      const offered = this.offeredSlots(conv.id);
      const slot = matchOfferedSlot([reply, text], offered);
      meta.claimRepaired = true;
      meta.rawText = reply;
      this.repo.logEvent(tenant.id, 'claim_repair', { conversation_id: conv.id, claim: run.unverifiedClaim, raw: reply });
      const hasActive = this.repo
        .appointmentsForContact(contact.id)
        .some((a) => (a.status === 'booked' || a.status === 'confirmed') && a.startsAt > this.clock.nowIso());
      const moving = run.unverifiedClaim === 'reschedule' || (hasActive && /remarc|mudar|trocar|adiar|reagend/.test(norm(text + ' ' + reply)));
      if (run.unverifiedClaim === 'cancel') {
        reply = 'Só pra confirmar: posso cancelar o seu agendamento?';
        this.setPendingAction(conv.id, { tool: 'cancel', args: {}, label: '' });
      } else if (slot && offered) {
        reply = moving ? `Só pra confirmar: posso remarcar para ${slot.label}?` : `Só pra confirmar: posso agendar ${offered.service} para ${slot.label}?`;
        this.setPendingAction(conv.id, {
          tool: moving ? 'reschedule' : 'book',
          args: moving ? { slot: slot.slot } : { service: offered.service, slot: slot.slot, contact: { name: contact.profile.nome ?? contact.waName } },
          label: slot.label,
        });
      } else {
        reply = 'Só pra eu confirmar certinho: qual dia e horário você prefere?';
      }
    }
    let escalated = run.calls.some((c) => c.name === 'escalate' && c.result.ok);
    let lowConfidence = !!run.error || run.exhausted;

    // Odonto: prices only when asked directly.
    const guardCtx: GuardContext = {
      services: tenant.services,
      quoteTotals: this.repo.quotesForConversation(conv.id).map((q) => q.total),
      ignoreStrings: [tenant.address, tenant.phone, tenant.pixKey, tenant.googleReviewLink, contact.phone],
    };
    if (pack.id === 'odonto' && !asksAboutPrice(text)) {
      const stripped = stripPriceSentences(reply, guardCtx);
      if (stripped !== reply.trim()) {
        this.repo.logEvent(tenant.id, 'price_suppressed', { conversation_id: conv.id, raw: reply });
        reply = stripped || 'Posso te ajudar com mais alguma coisa? Se quiser, agendo uma avaliação inicial pra você.';
      }
    }

    // Price guard.
    const guard = checkPrices(reply, guardCtx);
    let guardTriggered = false;
    if (!guard.ok) {
      guardTriggered = true;
      meta.guard = true;
      meta.rawText = reply;
      meta.offending = guard.offending;
      this.repo.logEvent(tenant.id, 'guard_violation', {
        conversation_id: conv.id,
        offending: guard.offending,
        discount: guard.discount,
        raw: reply,
      });
      reply = GUARD_REPLY;
      lowConfidence = true;
    }

    if (!reply.trim()) {
      reply = 'Só um instante, vou verificar isso direitinho e já te retorno.';
      lowConfidence = true;
    }
    if (looksLowConfidence(reply)) lowConfidence = true;

    const { msg, latency } = await send(reply, meta);

    if (guardTriggered && !escalated) {
      this.escalate(
        conv,
        guard.offending.length
          ? `valor fora da lista: ${guard.offending.map((v) => formatBRL(v)).join(', ')}`
          : `desconto/promocao inventado: ${guard.discount}`,
        'guard',
      );
      escalated = true;
    }
    if (!forceEscalation && !escalated && promisesHandoff(reply)) {
      forceEscalation = 'assistente prometeu passar para a equipe';
    }
    if (forceEscalation && !escalated) {
      this.escalate(conv, forceEscalation, 'policy');
      escalated = true;
    }
    const streak = lowConfidence && !escalated ? conv.lowConfStreak + 1 : 0;
    this.repo.setLowConfStreak(conv.id, streak);
    if (streak >= 2 && !escalated) {
      this.escalate(conv, 'duas respostas seguidas com baixa confianca', 'low_confidence');
      escalated = true;
    }
    if (run.error) this.repo.logEvent(tenant.id, 'llm_error', { conversation_id: conv.id, error: run.error });

    return {
      ...base,
      reply: msg,
      toolCalls: run.calls,
      escalated,
      guardTriggered,
      lowConfidence,
      latencyMs: latency,
      rawText: run.text,
      error: run.error,
    };
  }

  buildPromptContext(conv: Conversation, tenant: Tenant, pack: Pack, contact: Contact, notes: string[]): PromptContext {
    return {
      pack,
      tenant,
      contact: this.repo.getContact(contact.id) ?? contact,
      conversation: this.repo.getConversation(conv.id) ?? conv,
      history: this.repo.recentMessages(conv.id, 12),
      appointments: this.repo.appointmentsForContact(contact.id),
      quotes: this.repo.quotesForContact(contact.id),
      now: this.clock.now(),
      notes,
      offered: this.offeredSlots(conv.id),
    };
  }

  setPendingAction(convId: number, action: PendingAction): void {
    this.repo.setPendingNote(convId, PENDING_PREFIX + JSON.stringify(action));
  }

  /** A claim is fine when the DB already reflects it (e.g. "seu horario esta confirmado" after an earlier book). */
  claimBackedByDb(contactId: number, claim: ClaimKind, text: string): boolean {
    const appts = this.repo.appointmentsForContact(contactId);
    if (claim === 'cancel') return appts.some((a) => a.status === 'cancelled');
    const active = appts.filter((a) => a.status === 'booked' || a.status === 'confirmed');
    if (active.length === 0) return false;
    const t = norm(text);
    const mentionsTime = /\b\d{1,2}(:\d{2}|h\d{0,2})\b/.test(t);
    if (!mentionsTime) return true;
    return active.some((a) => {
      const hhmm = formatSlotPt(new Date(a.startsAt)).slice(-5);
      const [h, m] = hhmm.split(':');
      return [hhmm, `${Number(h)}:${m}`, `${Number(h)}h${m === '00' ? '' : m}`, `${h}h${m === '00' ? '' : m}`].some((v) => t.includes(v));
    });
  }

  /** Slots returned by the most recent successful check_availability in this conversation. */
  offeredSlots(convId: number): OfferedSlots | null {
    const evs = this.repo.events({ kind: 'tool_call', conversationId: convId });
    for (let i = evs.length - 1; i >= 0; i--) {
      const p = evs[i].payload as { name?: string; ok?: boolean; result?: { service?: string; slots?: OfferedSlots['slots'] } };
      if (p.name === 'check_availability' && p.ok && p.result?.slots?.length) {
        return { service: p.result.service ?? '', slots: p.result.slots.slice(0, 8) };
      }
    }
    return null;
  }

  /** The tool-call loop: at most `maxToolRounds` rounds of tool execution, then a final answer. */
  async runAssistant(
    conv: Conversation,
    tenant: Tenant,
    pack: Pack,
    contact: Contact,
    notes: string[],
    extraUserTurn?: string,
  ): Promise<{
    text: string;
    calls: ToolCallRecord[];
    rounds: number;
    exhausted: boolean;
    unverifiedClaim?: ClaimKind;
    error?: string;
  }> {
    const model = this.opts.model;
    const native = await this.llm.supportsTools(model);
    const ctx = this.buildPromptContext(conv, tenant, pack, contact, notes);
    const offered = ctx.offered ?? null;
    const lastCustomer = [...ctx.history].reverse().find((m) => m.role === 'customer');
    // The customer just picked one of the slots we offered: tell the model exactly how to book it.
    if (offered && lastCustomer) {
      const picked = matchOfferedSlot([this.customerText(lastCustomer)], offered);
      const alreadyBooked = this.repo
        .appointmentsForContact(contact.id)
        .some((a) => (a.status === 'booked' || a.status === 'confirmed') && formatSlotPt(new Date(a.startsAt)) === picked?.label);
      if (picked && !alreadyBooked) {
        ctx.notes = [
          ...ctx.notes,
          `O cliente acabou de escolher ${picked.label}. Se nao faltar nenhuma informacao essencial, chame agora ${
            this.repo.appointmentsForContact(contact.id).some((a) => a.status === 'booked' || a.status === 'confirmed') ? 'reschedule' : 'book'
          } com slot="${picked.slot}" (servico "${offered.service}"), sem consultar a agenda de novo.`,
        ];
      }
    }
    if (!native) ctx.promptedTools = TOOL_SPECS;
    const messages: ChatMessage[] = composeMessages(ctx);
    if (extraUserTurn) messages.push({ role: 'user', content: extraUserTurn });
    const toolCtx: ToolContext = {
      repo: this.repo,
      clock: this.clock,
      tenant,
      pack,
      contact,
      conversation: conv,
      recentCustomerText: ctx.history
        .filter((m) => m.role === 'customer')
        .slice(-4)
        .map((m) => this.customerText(m))
        .join(' '),
      onEscalate: (reason) => {
        this.pause(conv.id, 'escalation:tool');
        void reason;
      },
    };
    const known = new Set<string>(TOOL_NAMES);
    const calls: ToolCallRecord[] = [];
    let claimRetried = false;
    let nudged = false;
    let repeatRetried = false;
    let lastText = '';
    try {
      for (let round = 0; round <= this.opts.maxToolRounds; round++) {
        const allowTools = round < this.opts.maxToolRounds;
        if (!allowTools) {
          messages.push({
            role: 'user',
            content: '(Sistema) Limite de ferramentas atingido. Escreva agora a resposta final ao cliente, sem usar ferramentas.',
          });
        }
        const res = await this.llm.chat({
          model,
          messages,
          tools: native && allowTools ? TOOL_SPECS : undefined,
          temperature: this.opts.temperature,
          numPredict: this.opts.numPredict,
          label: 'assistant',
        });
        let content = stripThink(res.content);
        let toolCalls = res.toolCalls.filter((c) => known.has(c.name));
        if (toolCalls.length === 0) {
          const parsed = parseTextToolCalls(content, known);
          if (parsed.calls.length) {
            toolCalls = parsed.calls;
            content = parsed.rest;
          }
        }
        lastText = content;
        if (toolCalls.length === 0 || !allowTools) {
          // Guard against claiming an action that never happened (once per turn).
          const recentBot = ctx.history.filter((m) => m.role === 'assistant').slice(-3).map((m) => norm(m.text ?? ''));
          if (!repeatRetried && allowTools && round < this.opts.maxToolRounds - 1 && content.trim() && recentBot.includes(norm(content))) {
            repeatRetried = true;
            messages.push({ role: 'assistant', content });
            messages.push({
              role: 'user',
              content: '(Sistema) Voce repetiu uma mensagem anterior. Leia a ULTIMA mensagem do cliente e responda a ela (se ele escolheu um horario, use book ou reschedule).',
            });
            continue;
          }
          const didAction = calls.some((c) => ['book', 'reschedule', 'cancel'].includes(c.name) && c.result.ok);
          const claim = claimKind(content);
          const checked = calls.some((c) => c.name === 'check_availability');
          if (!claim && !checked && !nudged && allowTools && round < this.opts.maxToolRounds - 1 && promisesToCheck(content)) {
            nudged = true;
            messages.push({ role: 'assistant', content });
            messages.push({
              role: 'user',
              content: '(Sistema) Voce disse que ia verificar a agenda: chame check_availability agora e responda ja com 2 opcoes reais.',
            });
            continue;
          }
          if (claim && !didAction && !this.claimBackedByDb(contact.id, claim, content)) {
            if (!claimRetried && allowTools && round < this.opts.maxToolRounds - 1) {
              claimRetried = true;
              const slot = matchOfferedSlot([content, lastCustomer ? this.customerText(lastCustomer) : ''], offered);
              const tool = claim === 'cancel' ? 'cancel' : claim === 'reschedule' ? 'reschedule' : 'book';
              const exact =
                tool === 'cancel'
                  ? 'Chame agora cancel.'
                  : slot
                    ? `Chame agora ${tool} com ${JSON.stringify(tool === 'book' ? { service: offered!.service, slot: slot.slot } : { slot: slot.slot })}.`
                    : `Chame agora ${tool} com o slot "YYYY-MM-DD HH:MM" escolhido pelo cliente.`;
              this.repo.logEvent(tenant.id, 'claim_retry', { conversation_id: conv.id, claim, text: content });
              messages.push({ role: 'assistant', content });
              messages.push({
                role: 'user',
                content:
                  `(Sistema) Sua resposta afirma uma acao (${claim}) mas a ferramenta nao foi executada, entao NADA foi registrado. ${exact} ` +
                  'Se o cliente ainda nao escolheu, reescreva a resposta sem afirmar a acao.',
              });
              continue;
            }
            return { text: cleanReply(content), calls, rounds: round, exhausted: !allowTools, unverifiedClaim: claim };
          }
          return { text: cleanReply(content), calls, rounds: round, exhausted: !allowTools };
        }
        if (native) {
          messages.push({
            role: 'assistant',
            content,
            tool_calls: toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })),
          });
        } else {
          messages.push({ role: 'assistant', content: JSON.stringify({ tool: toolCalls[0].name, args: toolCalls[0].arguments }) });
          toolCalls = toolCalls.slice(0, 1); // prompted protocol: one call per round
        }
        for (const call of toolCalls) {
          const dup = calls.find((c) => c.name === call.name && JSON.stringify(c.args) === JSON.stringify(call.arguments));
          let result;
          if (dup && call.name !== 'check_availability') {
            result = { ok: false, error: 'chamada repetida; use o resultado anterior e responda ao cliente', anterior: dup.result };
          } else {
            try {
              result = await executeTool(toolCtx, call.name, call.arguments);
            } catch (err) {
              result = { ok: false, error: `falha interna: ${(err as Error).message}` };
            }
          }
          const effective = call.name === 'book' && result.converted_from === 'book' ? 'reschedule' : call.name;
          if (effective !== call.name) this.repo.logEvent(tenant.id, 'book_converted', { conversation_id: conv.id, args: call.arguments });
          calls.push({ name: effective, args: call.arguments, result });
          this.repo.logEvent(tenant.id, 'tool_call', {
            conversation_id: conv.id,
            name: call.name,
            args: call.arguments,
            ok: result.ok,
            result,
          });
          const payload = JSON.stringify(result);
          if (native) messages.push({ role: 'tool', content: payload, tool_name: call.name });
          else
            messages.push({
              role: 'user',
              content: `RESULTADO DA FERRAMENTA ${call.name}: ${payload}\nAgora chame outra ferramenta (JSON) se precisar, ou escreva a resposta final ao cliente em texto normal.`,
            });
        }
      }
      return { text: cleanReply(lastText), calls, rounds: this.opts.maxToolRounds, exhausted: true };
    } catch (err) {
      return {
        text: 'Desculpa a demora! Vou verificar isso com a equipe e já te retorno.',
        calls,
        rounds: 0,
        exhausted: false,
        error: (err as Error).message,
      };
    }
  }

  // ------------------------------------------------------------------ proactive messages

  private convFor(tenantId: string, contactId: number): Conversation {
    return this.repo.getOrCreateConversation(tenantId, contactId);
  }

  /** Confirmation reminders (templates) and reactivation / no-show recovery. */
  async sendReminder(rem: Reminder): Promise<Message | null> {
    const contact = this.repo.getContact(rem.contactId);
    if (!contact) return null;
    const { tenant, pack } = this.tenantAndPack(rem.tenantId);
    const appt = rem.appointmentId ? this.repo.getAppointment(rem.appointmentId) : null;
    if (rem.kind === 'reactivation' && contact.optOut) {
      this.repo.markReminderSent(rem.id);
      this.repo.setReminderResponse(rem.id, 'skipped_opt_out');
      return null;
    }
    if (rem.kind !== 'reactivation' && (!appt || appt.status === 'cancelled' || appt.status === 'done')) {
      this.repo.markReminderSent(rem.id);
      this.repo.setReminderResponse(rem.id, 'skipped_inactive');
      return null;
    }
    const conv = this.convFor(tenant.id, contact.id);
    const intro = this.introFor(pack, tenant);
    let text: string;
    let kind: string;
    if (rem.kind === 'reactivation') {
      if (appt?.status === 'no_show') {
        text = templates.noShowRecovery(contact, appt, intro);
        kind = 'no_show_recovery';
        this.repo.setPendingNote(
          conv.id,
          `Contexto: o cliente faltou ao agendamento #${appt.id} (${appt.service}). Nao cobre nem culpe; ofereca reencaixe usando check_availability e depois book.`,
        );
      } else {
        text = templates.reactivation(pack, contact, intro);
        kind = 'reactivation';
      }
    } else {
      text = templates.confirmReminder(contact, appt!, intro, rem.kind);
      kind = 'reminder';
    }
    const msg = await this.sendAssistant(conv, text, { kind, reminderId: rem.id });
    this.repo.markReminderSent(rem.id);
    this.repo.logEvent(tenant.id, 'reminder_sent', { conversation_id: conv.id, reminder_id: rem.id, kind: rem.kind, sub: kind });
    return msg;
  }

  /** Post-service message asking for a Google review (LLM-written, guarded, template fallback). */
  async sendReviewRequest(appt: Appointment): Promise<Message | null> {
    const contact = this.repo.getContact(appt.contactId);
    if (!contact || contact.optOut) return null;
    const { tenant, pack } = this.tenantAndPack(appt.tenantId);
    const conv = this.convFor(tenant.id, contact.id);
    const instruction =
      `[INSTRUCAO INTERNA, nao e mensagem do cliente] O cliente acabou de concluir o atendimento "${appt.service}" hoje. ` +
      `Escreva UMA mensagem curta e calorosa agradecendo pela visita e pedindo uma avaliacao no Google, incluindo exatamente este link: ${tenant.googleReviewLink} . ` +
      'Nao use ferramentas, nao cite precos, nao use travessao.';
    let text = '';
    try {
      const res = await this.llm.chat({
        model: this.opts.model,
        messages: [...composeMessages(this.buildPromptContext(conv, tenant, pack, contact, [])), { role: 'user', content: instruction }],
        temperature: 0.5,
        numPredict: 200,
        label: 'review_request',
      });
      text = cleanReply(res.content);
    } catch {
      text = '';
    }
    const guardOk = checkPrices(text, { services: tenant.services, ignoreStrings: [tenant.googleReviewLink] }).ok;
    if (!text || !guardOk || !text.includes(tenant.googleReviewLink) || !/avalia/i.test(norm(text))) {
      text = templates.reviewRequest(contact, tenant);
    }
    const msg = await this.sendAssistant(conv, text, { kind: 'review_request', appointmentId: appt.id });
    this.repo.logEvent(tenant.id, 'review_requested', { conversation_id: conv.id, appointment_id: appt.id });
    return msg;
  }

  // ------------------------------------------------------------------ owner controls

  takeOver(convId: number): Conversation {
    const c = this.repo.getConversation(convId);
    if (!c) throw new Error('conversation not found');
    this.repo.setConversationStatus(convId, 'human');
    this.repo.logEvent(c.tenantId, 'takeover', { conversation_id: convId });
    this.emitConversation(convId);
    return this.repo.getConversation(convId)!;
  }

  resume(convId: number): Conversation {
    const c = this.repo.getConversation(convId);
    if (!c) throw new Error('conversation not found');
    this.repo.setConversationStatus(convId, 'bot');
    this.repo.setLowConfStreak(convId, 0);
    this.repo.resolveAllEscalations(convId);
    this.repo.logEvent(c.tenantId, 'resume', { conversation_id: convId });
    this.emitConversation(convId);
    return this.repo.getConversation(convId)!;
  }

  async ownerMessage(convId: number, text: string): Promise<Message> {
    const c = this.repo.getConversation(convId);
    if (!c) throw new Error('conversation not found');
    if (c.status !== 'human') this.takeOver(convId); // owner typing pauses the bot, like on the phone
    const contact = this.repo.getContact(c.contactId)!;
    const clean = stripDashes(text).trim();
    const msg = this.repo.insertMessage({ conversationId: convId, role: 'owner', text: clean, status: 'sent' });
    this.repo.markCustomerMessagesRead(convId).forEach((m) => this.emitMessage(c.tenantId, m, 'updated'));
    this.emitMessage(c.tenantId, msg, 'created');
    await this.channel.send(this.ref(c, contact), { kind: 'text', text: clean });
    this.repo.logEvent(c.tenantId, 'owner_message', { conversation_id: convId, message_id: msg.id });
    this.emitConversation(convId);
    return msg;
  }

  // ------------------------------------------------------------------ memory

  /** Summarize what we know about a contact (runs when a conversation goes idle). */
  async summarizeContact(convId: number): Promise<string | null> {
    const conv = this.repo.getConversation(convId);
    if (!conv) return null;
    const contact = this.repo.getContact(conv.contactId);
    if (!contact) return null;
    const history = this.repo.recentMessages(convId, 30);
    if (history.length < 2) return null;
    const transcript = history
      .map((m) => `${m.role === 'customer' ? 'Cliente' : m.role === 'owner' ? 'Equipe' : 'Assistente'}: ${this.customerText(m) || m.text || ''}`)
      .join('\n');
    const res = await this.llm.chat({
      model: this.opts.model,
      temperature: 0.2,
      numPredict: 160,
      label: 'memory',
      messages: [
        {
          role: 'system',
          content:
            'Resuma em ate 3 linhas curtas, em portugues, fatos uteis e duradouros sobre este cliente para futuros atendimentos ' +
            '(preferencias de horario/profissional, veiculo ou pet, servicos de interesse, pendencias). ' +
            'Nao inclua dados de saude, documentos ou valores. Nao use travessao. Se a memoria anterior ainda for valida, mantenha.',
        },
        { role: 'user', content: `Memoria anterior: ${contact.memorySummary ?? '(nenhuma)'}\n\nConversa:\n${transcript}` },
      ],
    });
    const summary = stripDashes(stripThink(res.content)).slice(0, 600).trim();
    if (summary) {
      this.repo.setMemorySummary(contact.id, summary);
      this.repo.logEvent(conv.tenantId, 'memory_updated', { conversation_id: convId, contact_id: contact.id });
    }
    return summary || null;
  }

  personaOf(tenantId: string): string {
    const { tenant, pack } = this.tenantAndPack(tenantId);
    return personaFor(pack, tenant);
  }
}

export type ClaimKind = 'book' | 'reschedule' | 'cancel';

const PENDING_PREFIX = 'ACTION:';
export interface PendingAction {
  tool: 'book' | 'reschedule' | 'cancel';
  args: Record<string, unknown>;
  label: string;
}

/** Short affirmative answer to a yes/no confirmation question. */
export function isAffirmative(text: string): boolean {
  const t = norm(text).replace(/[!.,]+/g, ' ').trim();
  if (/\bnao\b/.test(t)) return false;
  return /^(sim|s|pode|pode sim|pode ser|pode agendar|pode marcar|pode remarcar|pode cancelar|confirmo|confirmado|confirma|isso|isso mesmo|blz|beleza|fechado|ok|okay|claro|perfeito|bora|show|com certeza|manda ver|quero|quero sim|certo|ta bom|tá bom|ta otimo|otimo)\b/.test(t);
}

export interface OfferedSlots {
  service: string;
  slots: { slot: string; label: string; staff?: string }[];
}

/** Detects a statement (not a question) that an appointment was booked/rescheduled/cancelled. */
export function claimKind(text: string): ClaimKind | null {
  const sentences = text.split(/(?<=[.!?\n])\s+/).filter((x) => x.trim() && !x.trim().endsWith('?'));
  for (const sRaw of sentences) {
    const s = norm(sRaw);
    if (!ACTION_CLAIM.test(s)) continue;
    if (/\b(se quiser|posso|quer que|gostaria|prefere|podemos|vamos)\b/.test(s)) continue;
    if (/cancelad/.test(s)) return 'cancel';
    if (/remarcad/.test(s)) return 'reschedule';
    return 'book';
  }
  return null;
}

export function promisesToCheck(text: string): boolean {
  return /\b(vou|vamos|deixa eu|deixe-me|deixe eu|ja vou|irei)\s+(verificar|consultar|checar|ver|olhar)\b/.test(norm(text));
}

/** Find which offered slot the texts refer to (time HH:MM, preferring a matching dd/mm). */
export function matchOfferedSlot(texts: string[], offered: OfferedSlots | null): OfferedSlots['slots'][number] | null {
  if (!offered) return null;
  const joined = norm(texts.join(' '));
  const hits = offered.slots.filter((s) => {
    const hhmm = s.slot.slice(11, 16);
    const [h, m] = hhmm.split(':');
    const variants = [hhmm, `${Number(h)}:${m}`, `${Number(h)}h${m}`, m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`];
    return variants.some((v) => new RegExp(`(^|[^\\d])${v.replace(':', '\\:')}(?![\\d])`).test(joined));
  });
  if (hits.length === 0) return null;
  const withDate = hits.find((s) => joined.includes(`${s.slot.slice(8, 10)}/${s.slot.slice(5, 7)}`));
  return withDate ?? hits[0];
}

/** Final cleanup of model text before it reaches guards and the customer. */
export function cleanReply(s: string): string {
  let t = stripThink(s);
  t = t.replace(/<\/?tool_call>/g, '');
  t = t.replace(/^\s*(assistente|assistant|resposta)\s*:\s*/i, '');
  t = t.replace(/\b([Ss]ou|[Aa]qui (?:é|e))\s+(a|o)\s+[A-ZÀ-Ý][a-zà-ÿ]+(?:,\s+(?:(?:sua|seu|a|o)\s+)?|\s+(?:sua|seu)\s+)/g, '$1 $2 ');
  t = t.replace(/\b(me chamo|meu nome (?:é|e))\s+[A-ZÀ-Ý][a-zà-ÿ]+[,.!]?\s*/gi, '');
  t = t.replace(/\n{3,}/g, '\n\n');
  // Repair a price glued to a duration: "R$90,15 min" -> "R$90 (15 min)".
  t = t.replace(/(R\$\s?\d+(?:\.\d{3})*),(\d{1,3})\s?(min|minutos)\b/gi, '$1 ($2 $3)');
  t = stripDashes(t).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
