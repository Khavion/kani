// Seeds demo tenants and one week of deterministic demo history (for the /admin dashboard).
// All prices come from the tenant's services list; nothing is invented.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import type { Repo, Tenant } from '../db/repo.ts';
import { getPack } from '../packs/packs.ts';
import type { HoursMap, ServiceDTO, StaffDTO } from '../shared/api.ts';
import { addDays, addMinutes, formatSlotPt, fromLocal, hhmmToMinutes, toLocal } from '../util/time.ts';
import { formatBRL } from '../util/text.ts';

interface SeedTenant {
  id: string;
  name: string;
  pack_id: string;
  phone: string;
  address: string;
  hours: HoursMap;
  staff: StaffDTO[];
  services?: ServiceDTO[];
  pix_key: string;
  google_review_link: string;
  settings?: Record<string, unknown>;
}

export function loadSeedTenants(file = path.join(ROOT, 'seed/tenants.json')): SeedTenant[] {
  return (JSON.parse(readFileSync(file, 'utf8')) as { tenants: SeedTenant[] }).tenants;
}

export function seedTenants(repo: Repo, file?: string): Tenant[] {
  const out: Tenant[] = [];
  for (const t of loadSeedTenants(file)) {
    if (repo.getTenant(t.id)) {
      out.push(repo.getTenant(t.id)!);
      continue;
    }
    const pack = getPack(t.pack_id);
    out.push(
      repo.insertTenant({
        id: t.id,
        name: t.name,
        packId: t.pack_id,
        phone: t.phone,
        address: t.address,
        hours: t.hours,
        staff: t.staff,
        services: t.services ?? pack.services.map((s) => ({ ...s })),
        pixKey: t.pix_key,
        googleReviewLink: t.google_review_link,
        settings: t.settings ?? {},
      }),
    );
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Demo history

function rng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  'Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Santos', 'Eduarda Rocha', 'Felipe Costa', 'Gabriela Alves',
  'Henrique Dias', 'Isabela Nunes', 'Joao Pereira', 'Karina Freitas', 'Lucas Martins', 'Mariana Lopes',
  'Nicolas Barros', 'Patricia Ramos', 'Rafaela Teixeira', 'Thiago Moreira', 'Vanessa Castro', 'Wagner Pinto', 'Yasmin Correia',
];

const SENSITIVE_OPENERS: Record<string, { text: string; reason: string }> = {
  oficina: { text: 'o carro voltou com o mesmo barulho depois do servico de voces, quero garantia', reason: 'garantia/reclamacao de servico anterior' },
  salao: { text: 'fiz progressiva ai e meu couro cabeludo ta ardendo ate agora', reason: 'tema sensivel: reacao a quimica' },
  odonto: { text: 'to com muita dor no dente e o rosto ta inchado', reason: 'tema sensivel: dor forte' },
  pet: { text: 'meu cachorro ta vomitando desde ontem, o que eu dou pra ele?', reason: 'tema sensivel: vomito' },
  estetica: { text: 'to gravida de 12 semanas, posso fazer drenagem?', reason: 'tema sensivel: gestante' },
};

const QUESTION_TEMPLATES = [
  (s: string) => `oi, qnto ta ${s}?`,
  (s: string) => `qual o valor de ${s}?`,
  (s: string) => `boa tarde! quanto custa ${s}?`,
];

export function seedDemoHistory(repo: Repo, now: Date): void {
  for (const tenant of repo.listTenants()) {
    if (repo.listContacts(tenant.id).length > 0) continue;
    seedTenantHistory(repo, tenant, now);
  }
}

function seedTenantHistory(repo: Repo, tenant: Tenant, now: Date): void {
  const pack = getPack(tenant.packId);
  const rand = rng(tenant.id);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const bookable = tenant.services.filter((s) => s.p > 0 && s.min > 0);
  const staffNames = tenant.staff.map((s) => s.name);
  let nameIdx = Math.floor(rand() * NAMES.length);
  let phoneSeq = 1000 + Math.floor(rand() * 8000);
  const db = repo.db;

  const newContact = () => {
    const name = NAMES[nameIdx++ % NAMES.length];
    const phone = `+55 11 9${String(phoneSeq++).padStart(4, '0')}-${String(Math.floor(rand() * 9000) + 1000)}`;
    const c = repo.upsertContact(tenant.id, phone, name);
    db.prepare('UPDATE contacts SET created_at = ? WHERE id = ?').run(addDays(now, -8).toISOString(), c.id);
    return c;
  };
  // A business-hours instant `daysAgo` days back at local hour `h`.
  const at = (daysAgo: number, h: number, m = 0) => {
    const p = toLocal(addDays(now, -daysAgo));
    return fromLocal(p.year, p.month, p.day, h, m);
  };
  const say = (convId: number, role: 'customer' | 'assistant' | 'owner', text: string, t: Date, latencyMs: number | null = null, meta: Record<string, unknown> = {}) =>
    repo.insertMessage({ conversationId: convId, role, text, createdAt: t.toISOString(), latencyMs, status: role === 'customer' ? 'read' : 'sent', meta });
  const intro = `Oi! Eu sou ${pack.persona_pt.match(/^(o|a)\s+(\S+)/i)?.[0] ?? 'o assistente'} virtual ${(tenant.settings.preposition as string) ?? 'de'} ${tenant.name}.`;
  const setDisclosed = (convId: number) => repo.setDisclosed(convId);
  const lat = () => 3000 + Math.floor(rand() * 9000);

  const appointmentAt = (daysAgo: number, hour: number, service: ServiceDTO, status: 'booked' | 'confirmed' | 'done' | 'no_show', contactId: number, convId: number | null, createdAt: Date) => {
    const start = at(daysAgo, hour);
    return repo.insertAppointment({
      tenantId: tenant.id,
      contactId,
      service: service.n,
      staff: pick(staffNames),
      startsAt: start.toISOString(),
      endsAt: addMinutes(start, Math.max(service.min, pack.booking_rules.slot_min)).toISOString(),
      status,
      price: service.p,
      source: 'bot',
      conversationId: convId,
      createdAt: createdAt.toISOString(),
    });
  };

  const openDay = (daysAgo: number) => {
    // move to a day the business is open
    for (let d = daysAgo; d < daysAgo + 7; d++) {
      const p = toLocal(addDays(now, -d));
      if (tenant.hours[p.weekday]) return d;
    }
    return daysAgo;
  };
  const futureOpenDay = (ahead: number) => {
    for (let d = ahead; d < ahead + 7; d++) {
      const p = toLocal(addDays(now, d));
      if (tenant.hours[p.weekday]) return -d;
    }
    return -ahead;
  };
  const openHour = (daysAgo: number) => {
    const span = tenant.hours[toLocal(addDays(now, -daysAgo)).weekday];
    if (!span) return 10;
    const start = hhmmToMinutes(span[0]) / 60;
    const end = hhmmToMinutes(span[1]) / 60;
    return Math.min(end - 2, Math.max(start + 1, Math.floor(start + 1 + rand() * (end - start - 3))));
  };

  // 1) Price questions (3), answered in seconds; one of them after hours.
  for (let i = 0; i < 3; i++) {
    const c = newContact();
    const conv = repo.getOrCreateConversation(tenant.id, c.id);
    const s = pick(bookable);
    const d = openDay(1 + i * 2);
    const afterHours = i === 0;
    const t0 = afterHours ? at(d, 22, 10) : at(d, openHour(d), 15);
    say(conv.id, 'customer', pick(QUESTION_TEMPLATES)(s.n.toLowerCase()), t0, null, afterHours ? { afterHours: true } : {});
    say(conv.id, 'assistant', `${intro} ${s.n} sai ${formatBRL(s.p)}. Quer que eu veja um horário pra você?`, addMinutes(t0, 0.2), lat());
    say(conv.id, 'customer', 'vou ver aqui e te aviso, obrigado!', addMinutes(t0, 3));
    say(conv.id, 'assistant', 'Combinado! Qualquer coisa é só chamar por aqui.', addMinutes(t0, 3.15), lat());
    setDisclosed(conv.id);
  }

  // 2) Bookings (3) with confirm reminders; one after hours.
  for (let i = 0; i < 3; i++) {
    const c = newContact();
    const conv = repo.getOrCreateConversation(tenant.id, c.id);
    const s = pick(bookable);
    const d = openDay(1 + i * 2);
    const afterHours = i === 1;
    const t0 = afterHours ? at(d, 21, 40) : at(d, openHour(d), 5);
    const apptDay = i === 2 ? futureOpenDay(2) : Math.max(0, d - 1);
    const hour = 10 + i * 2;
    say(conv.id, 'customer', `queria marcar ${s.n.toLowerCase()}, tem horario?`, t0, null, afterHours ? { afterHours: true } : {});
    const slotA = at(apptDay, hour);
    const slotB = at(apptDay, hour + 1);
    say(conv.id, 'assistant', `${intro} Tenho ${formatSlotPt(slotA)} ou ${formatSlotPt(slotB)}. Qual fica melhor?`, addMinutes(t0, 0.2), lat(), { tools: ['check_availability'] });
    say(conv.id, 'customer', 'o primeiro ta otimo, pode marcar. meu nome e ' + c.waName.split(' ')[0], addMinutes(t0, 2));
    const status = apptDay > 0 ? (i === 0 ? 'done' : 'confirmed') : 'booked';
    const appt = appointmentAt(apptDay, hour, s, status, c.id, conv.id, addMinutes(t0, 2.2));
    say(conv.id, 'assistant', `Agendado! ${s.n}, ${formatSlotPt(slotA)}. Te mando um lembrete um dia antes.`, addMinutes(t0, 2.3), lat(), { tools: ['book'] });
    setDisclosed(conv.id);
    if (apptDay > 0) {
      const fire = new Date(slotA.getTime() - 24 * 3_600_000);
      repo.insertReminder({ appointmentId: appt.id, tenantId: tenant.id, contactId: c.id, fireAt: fire.toISOString(), kind: 'confirm_24h', sent: true, sentAt: fire.toISOString(), response: '1' });
      say(conv.id, 'assistant', `Oi, ${c.waName.split(' ')[0]}! Passando pra lembrar do seu horário: ${s.n}, ${formatSlotPt(slotA)}. Responda 1 para confirmar, 2 para remarcar.`, fire, null, { kind: 'reminder' });
      say(conv.id, 'customer', '1', addMinutes(fire, 12));
      say(conv.id, 'assistant', `Confirmado! Te esperamos ${formatSlotPt(slotA)}.`, addMinutes(fire, 12.1), 900, { kind: 'reminder_confirmed' });
    } else {
      const fire = new Date(slotA.getTime() - 24 * 3_600_000);
      repo.insertReminder({ appointmentId: appt.id, tenantId: tenant.id, contactId: c.id, fireAt: fire.toISOString(), kind: 'confirm_24h' });
    }
  }

  // 3) No-show (reminder sent, no answer).
  {
    const c = newContact();
    const conv = repo.getOrCreateConversation(tenant.id, c.id);
    const s = pick(bookable);
    const d = openDay(2);
    const t0 = at(d + 2, openHour(d + 2), 30);
    say(conv.id, 'customer', `tem vaga pra ${s.n.toLowerCase()} essa semana?`, t0);
    const slot = at(d, 15);
    say(conv.id, 'assistant', `${intro} Tenho ${formatSlotPt(slot)}. Pode ser?`, addMinutes(t0, 0.2), lat(), { tools: ['check_availability'] });
    say(conv.id, 'customer', 'pode sim', addMinutes(t0, 5));
    const appt = appointmentAt(d, 15, s, 'no_show', c.id, conv.id, addMinutes(t0, 5.1));
    say(conv.id, 'assistant', `Agendado! ${s.n}, ${formatSlotPt(slot)}.`, addMinutes(t0, 5.2), lat(), { tools: ['book'] });
    const fire = new Date(slot.getTime() - 24 * 3_600_000);
    repo.insertReminder({ appointmentId: appt.id, tenantId: tenant.id, contactId: c.id, fireAt: fire.toISOString(), kind: 'confirm_24h', sent: true, sentAt: fire.toISOString() });
    setDisclosed(conv.id);
  }

  // 4) Reactivated customer: old visit, reactivation message, new booking.
  {
    const c = newContact();
    const conv = repo.getOrCreateConversation(tenant.id, c.id);
    const s = pick(bookable);
    const old = appointmentAt(pack.reminders.reactivation_days + 12, 11, s, 'done', c.id, conv.id, at(pack.reminders.reactivation_days + 14, 10));
    const d = openDay(3);
    const fire = at(d, 10);
    repo.insertReminder({ appointmentId: old.id, tenantId: tenant.id, contactId: c.id, fireAt: fire.toISOString(), kind: 'reactivation', sent: true, sentAt: fire.toISOString(), response: 'replied' });
    say(conv.id, 'assistant', `Oi, ${c.waName.split(' ')[0]}! ${intro} Faz um tempinho desde a sua última visita. Que tal ${pack.reminders.reactivation_pt.replace('{modelo}', 'seu carro').replace('{pet}', 'seu pet')}? Posso ver um horário pra você.`, fire, null, { kind: 'reactivation' });
    say(conv.id, 'customer', 'opa, verdade! pode ver pra mim sim', addMinutes(fire, 20));
    const slotDay = futureOpenDay(1);
    const slot = at(slotDay, 14);
    say(conv.id, 'assistant', `Tenho ${formatSlotPt(slot)}. Fica bom?`, addMinutes(fire, 20.2), lat(), { tools: ['check_availability'] });
    say(conv.id, 'customer', 'fechado', addMinutes(fire, 25));
    appointmentAt(slotDay, 14, s, 'booked', c.id, conv.id, addMinutes(fire, 25.1));
    say(conv.id, 'assistant', `Agendado! ${s.n}, ${formatSlotPt(slot)}. Até lá!`, addMinutes(fire, 25.2), lat(), { tools: ['book'] });
    setDisclosed(conv.id);
  }

  // 5) Escalation (sensitive topic / complaint), resolved by the owner.
  {
    const c = newContact();
    const conv = repo.getOrCreateConversation(tenant.id, c.id);
    const op = SENSITIVE_OPENERS[pack.id] ?? SENSITIVE_OPENERS.oficina;
    const d = openDay(1);
    const t0 = at(d, openHour(d), 40);
    say(conv.id, 'customer', op.text, t0);
    say(conv.id, 'assistant', `${intro} Sinto muito por isso. Já avisei a equipe, que vai continuar o atendimento com você em instantes.`, addMinutes(t0, 0.2), lat(), { tools: ['escalate'] });
    const esc = repo.insertEscalation(conv.id, op.reason);
    db.prepare('UPDATE escalations SET created_at = ?, resolved = 1 WHERE id = ?').run(addMinutes(t0, 0.3).toISOString(), esc.id);
    say(conv.id, 'owner', 'Oi! Aqui é da equipe. Já vi sua mensagem e vou te ligar agora, tudo bem?', addMinutes(t0, 6));
    setDisclosed(conv.id);
  }

  // 6) Open escalation from the price guard (bot asked to confirm a value).
  {
    const c = newContact();
    const conv = repo.getOrCreateConversation(tenant.id, c.id);
    const d = openDay(0);
    const t0 = at(d, Math.max(9, openHour(d)), 20);
    say(conv.id, 'customer', 'voces fazem pacote com desconto pra 3 servicos juntos?', t0);
    say(conv.id, 'assistant', 'vou confirmar esse valor certinho e já te retorno', addMinutes(t0, 0.2), lat(), { guard: true });
    const esc = repo.insertEscalation(conv.id, 'valor fora da lista');
    db.prepare('UPDATE escalations SET created_at = ? WHERE id = ?').run(addMinutes(t0, 0.3).toISOString(), esc.id);
    repo.setConversationStatus(conv.id, 'human');
    setDisclosed(conv.id);
  }

  // 7) Oficina quotes (one approved with the approval message id).
  if (pack.id === 'oficina') {
    for (let i = 0; i < 2; i++) {
      const c = newContact();
      const conv = repo.getOrCreateConversation(tenant.id, c.id);
      const d = openDay(2 + i * 2);
      const t0 = at(d, openHour(d), 0);
      const items = i === 0 ? [tenant.services[1], tenant.services[4]] : [tenant.services[2]];
      const total = items.reduce((a, s) => a + s.p, 0);
      say(conv.id, 'customer', i === 0 ? 'carro puxando pro lado e com luz no painel, quanto fica pra ver?' : 'preciso trocar as pastilhas da frente, onix 2019', t0);
      say(conv.id, 'assistant', `${intro} Pré-orçamento: ${items.map((s) => `${s.n} ${formatBRL(s.p)}`).join(' + ')}, total ${formatBRL(total)}. Posso seguir? Se aprovar, é só responder "aprovo".`, addMinutes(t0, 0.3), lat(), { tools: ['create_quote'] });
      const quote = repo.insertQuote({ tenantId: tenant.id, contactId: c.id, conversationId: conv.id, items: items.map((s) => ({ service: s.n, qty: 1, price: s.p })), total });
      db.prepare('UPDATE quotes SET created_at = ? WHERE id = ?').run(addMinutes(t0, 0.3).toISOString(), quote.id);
      if (i === 0) {
        const ok = say(conv.id, 'customer', 'aprovo, pode fazer', addMinutes(t0, 30));
        repo.setQuoteStatus(quote.id, 'approved', ok.id);
        say(conv.id, 'assistant', 'Perfeito, serviço autorizado! Te aviso assim que o carro estiver pronto.', addMinutes(t0, 30.2), lat());
      }
      setDisclosed(conv.id);
    }
  }

  // 8) An older loyal customer who is due for reactivation (the scheduler will reach out).
  {
    const c = newContact();
    const conv = repo.getOrCreateConversation(tenant.id, c.id);
    const s = pick(bookable);
    const d = pack.reminders.reactivation_days + 5;
    appointmentAt(d, 10, s, 'done', c.id, conv.id, at(d + 2, 10));
    say(conv.id, 'customer', `obrigado pelo atendimento no ${s.n.toLowerCase()}!`, at(d, 12));
    say(conv.id, 'assistant', 'Nós que agradecemos! Até a próxima.', addMinutes(at(d, 12), 0.2), lat());
    setDisclosed(conv.id);
  }
}
