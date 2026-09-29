// Weekly owner metrics (English labels) computed from the domain tables.

import type { Repo } from '../db/repo.ts';
import type { WeeklyMetricsDTO } from '../shared/api.ts';
import { norm } from '../util/text.ts';

const QUESTION_INTENTS: { label: string; re: RegExp }[] = [
  { label: 'Price of a service', re: /\b(quanto|qnto|qto|valor|preco|custa|sai por|fica quanto)\b/ },
  { label: 'Availability / booking', re: /\b(horario|vaga|agenda|agendar|marcar|encaixe|disponivel)\b/ },
  { label: 'Reschedule or cancel', re: /\b(remarcar|cancelar|desmarcar|mudar o horario)\b/ },
  { label: 'Payment methods / Pix', re: /\b(pix|cartao|parcel|dinheiro|pagamento|pagar)\b/ },
  { label: 'Opening hours', re: /\b(abre|abrem|fecha|fecham|funciona|funcionamento|que horas)\b/ },
  { label: 'Location / directions', re: /\b(endereco|onde fica|localizacao|como chego|estacionamento)\b/ },
  { label: 'Services offered', re: /\b(voces fazem|faz |fazem|atendem|trabalham com|mexem)\b/ },
  { label: 'Health / clinical question', re: /\b(dor|gravida|alergi|remedio|vomit|inchad|sangr)\b/ },
];

function reasonCategory(reason: string): string {
  const r = norm(reason);
  if (r.startsWith('valor fora da lista')) return 'Price not on list (guard)';
  if (r.includes('pediu atendimento humano') || r.includes('humano')) return 'Customer asked for a human';
  if (r.startsWith('tema sensivel') || r.includes('saude') || r.includes('clinic')) return 'Sensitive / clinical topic';
  if (r.includes('bravo') || r.includes('insatisfeito') || r.includes('reclama')) return 'Upset customer / complaint';
  if (r.includes('garantia')) return 'Warranty / previous service';
  if (r.includes('baixa confianca')) return 'Low confidence (2 turns)';
  if (r.includes('fora do escopo') || r.includes('eletrico')) return 'Out of scope';
  return reason.length > 48 ? reason.slice(0, 45) + '...' : reason;
}

export function computeWeeklyMetrics(repo: Repo, opts: { tenantId?: string | 'all'; end?: Date } = {}): WeeklyMetricsDTO {
  const tenantId = opts.tenantId && opts.tenantId !== 'all' ? opts.tenantId : null;
  const end = opts.end ?? repo.clock.now();
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const s = start.toISOString();
  const e = end.toISOString();
  const tenants = repo.listTenants().filter((t) => !tenantId || t.id === tenantId);
  const tIds = tenants.map((t) => t.id);
  const inT = `(${tIds.map(() => '?').join(',') || "''"})`;

  const q = (sql: string, ...params: (string | number)[]) => repo.query(sql, ...params);
  const n = (sql: string, ...params: (string | number)[]) => Number(q(sql, ...params)[0]?.n ?? 0);

  const conversationsHandled = n(
    `SELECT COUNT(DISTINCT m.conversation_id) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.tenant_id IN ${inT} AND m.role IN ('assistant','owner') AND m.created_at BETWEEN ? AND ?`,
    ...tIds, s, e,
  );

  const replies = q(
    `SELECT m.latency_ms FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.tenant_id IN ${inT} AND m.role = 'assistant' AND m.latency_ms IS NOT NULL AND m.created_at BETWEEN ? AND ?`,
    ...tIds, s, e,
  );
  const under = replies.filter((r) => Number(r.latency_ms) < 60_000).length;
  const answeredUnder1MinPct = replies.length ? Math.round((under / replies.length) * 1000) / 10 : 0;

  const afterHoursLeads = n(
    `SELECT COUNT(DISTINCT m.conversation_id) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.tenant_id IN ${inT} AND m.role = 'customer' AND json_extract(m.meta_json, '$.afterHours') = 1
     AND m.created_at BETWEEN ? AND ?
     AND EXISTS (SELECT 1 FROM messages r WHERE r.conversation_id = m.conversation_id AND r.role = 'assistant' AND r.id > m.id)`,
    ...tIds, s, e,
  );

  const bookings = q(
    `SELECT tenant_id, price, status FROM appointments WHERE tenant_id IN ${inT} AND source = 'bot' AND created_at BETWEEN ? AND ?`,
    ...tIds, s, e,
  );
  const bookingsCreated = bookings.length;
  const attributedRevenue = bookings.filter((b) => b.status !== 'cancelled').reduce((a, b) => a + Number(b.price ?? 0), 0);

  const reminders = q(
    `SELECT r.kind, r.response, a.status AS appt_status FROM reminders r LEFT JOIN appointments a ON a.id = r.appointment_id
     WHERE r.tenant_id IN ${inT} AND r.sent = 1 AND r.sent_at BETWEEN ? AND ? AND r.kind IN ('confirm_24h','confirm_2h')`,
    ...tIds, s, e,
  ).filter((r) => !String(r.response ?? '').startsWith('skipped') && r.response !== 'error');
  const remindersSent = reminders.length;
  const confirmedCount = reminders.filter((r) => r.response === '1').length;
  const reminderConfirmationRate = remindersSent ? Math.round((confirmedCount / remindersSent) * 1000) / 10 : 0;
  const noShowsAvoided = reminders.filter((r) => (r.response === '1' || r.response === '2') && r.appt_status !== 'no_show').length;

  const quotes = q(
    `SELECT status, total FROM quotes WHERE tenant_id IN ${inT} AND created_at BETWEEN ? AND ?`,
    ...tIds, s, e,
  );
  const quotesSent = quotes.length;
  const quotesSentValue = quotes.reduce((a, x) => a + Number(x.total), 0);
  const approved = quotes.filter((x) => x.status === 'approved');
  const quotesApproved = approved.length;
  const quotesApprovedValue = approved.reduce((a, x) => a + Number(x.total), 0);

  const reactivatedCustomers = n(
    `SELECT COUNT(DISTINCT r.contact_id) AS n FROM reminders r
     WHERE r.tenant_id IN ${inT} AND r.kind = 'reactivation' AND r.sent = 1 AND r.sent_at BETWEEN ? AND ?
     AND EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = r.contact_id AND a.created_at > r.sent_at AND a.status != 'cancelled')`,
    ...tIds, s, e,
  );

  const escRows = q(
    `SELECT e.id, e.reason, e.created_at, e.resolved, c.tenant_id FROM escalations e JOIN conversations c ON c.id = e.conversation_id
     WHERE c.tenant_id IN ${inT} AND e.created_at BETWEEN ? AND ? ORDER BY e.created_at DESC`,
    ...tIds, s, e,
  );
  const byReasonMap = new Map<string, number>();
  for (const r of escRows) byReasonMap.set(reasonCategory(r.reason), (byReasonMap.get(reasonCategory(r.reason)) ?? 0) + 1);
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

  const questions = q(
    `SELECT m.text FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.tenant_id IN ${inT} AND m.role = 'customer' AND m.text IS NOT NULL AND m.created_at BETWEEN ? AND ?`,
    ...tIds, s, e,
  );
  const intentCount = new Map<string, { count: number; example: string }>();
  for (const r of questions) {
    const text = String(r.text);
    const t = norm(text);
    const intent = QUESTION_INTENTS.find((i) => i.re.test(t));
    if (!intent) continue;
    if (!t.includes('?') && !/\b(quanto|qnto|qual|tem |voces|pode|posso|aceita|onde|como)\b/.test(t)) continue;
    const cur = intentCount.get(intent.label) ?? { count: 0, example: text };
    cur.count++;
    intentCount.set(intent.label, cur);
  }
  const topQuestions = [...intentCount.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([label, v]) => ({ question: `${label} (e.g. "${v.example.slice(0, 60)}")`, count: v.count }));

  const perTenant = tenants.map((t) => ({
    tenantId: t.id,
    tenantName: t.name,
    conversationsHandled: n(
      `SELECT COUNT(DISTINCT m.conversation_id) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.tenant_id = ? AND m.role IN ('assistant','owner') AND m.created_at BETWEEN ? AND ?`,
      t.id, s, e,
    ),
    bookingsCreated: bookings.filter((b) => b.tenant_id === t.id).length,
    escalations: escRows.filter((r) => r.tenant_id === t.id).length,
    attributedRevenue: bookings.filter((b) => b.tenant_id === t.id && b.status !== 'cancelled').reduce((a, b) => a + Number(b.price ?? 0), 0),
  }));

  return {
    tenantId: tenantId ?? 'all',
    weekStart: s,
    weekEnd: e,
    conversationsHandled,
    answeredUnder1MinPct,
    afterHoursLeads,
    bookingsCreated,
    remindersSent,
    reminderConfirmationRate,
    noShowsAvoided,
    quotesSent,
    quotesSentValue,
    quotesApproved,
    quotesApprovedValue,
    reactivatedCustomers,
    escalations: {
      total: escRows.length,
      byReason: [...byReasonMap.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
      recent: escRows.slice(0, 10).map((r) => ({
        id: Number(r.id),
        tenantName: tenantName.get(r.tenant_id) ?? r.tenant_id,
        reason: r.reason,
        createdAt: r.created_at,
        resolved: !!r.resolved,
      })),
    },
    topQuestions,
    attributedRevenue,
    perTenant,
  };
}
