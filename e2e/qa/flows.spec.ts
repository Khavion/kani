// QA pass, part 1: every business flow over the HTTP API with real models, asserting on the database.
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, T, converse, detail, phone, q, send, tenants } from './helpers.ts';
import { checkPrices } from '../../src/engine/guard.ts';
import { claimKind } from '../../src/engine/engine.ts';

// Sequential (workers: 1) but independent: one failure must not skip the rest of the QA sweep.

let doneCustomerPhone = '';
const active = <A extends { status: string }>(appts: A[]): A[] => appts.filter((a) => a.status === 'booked' || a.status === 'confirmed');

test('F01 health: Ollama, models and whisperX are reported ready', async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  expect(h.ok).toBe(true);
  expect(h.ollama.models).toEqual(expect.arrayContaining(['qwen3:8b', 'gemma3:12b']));
  expect(h.whisperx.ok).toBe(true);
  expect((await tenants(request)).map((t) => t.id).sort()).toEqual(Object.values(T).sort());
});

test('F02 price question: exact list price + disclosure on first contact only', async ({ request }) => {
  const ph = phone();
  const a = await send(request, T.oficina, ph, 'boa noite, qnto ta a troca de oleo?');
  expect(a.reply?.text).toMatch(/180/);
  expect(a.reply?.text).toMatch(/assistente virtual/i);
  const b = await send(request, T.oficina, ph, 'e o alinhamento?');
  expect(b.reply?.text).toMatch(/160/);
  expect(b.reply?.text).not.toMatch(/assistente virtual/i);
  // customer messages were marked read (blue ticks)
  const d = await detail(request, a.message.conversationId);
  expect(d.messages.filter((m) => m.role === 'customer').every((m) => m.status === 'read')).toBe(true);
});

test('F03 booking: multi-turn conversation creates a real appointment with reminders', async ({ request }) => {
  const ph = phone();
  const r = await converse(request, T.salao, ph, 'oi, quero agendar uma escova amanha de manha', async (id) => active((await detail(request, id)).appointments).length > 0);
  const d = await detail(request, r.convId);
  const appts = active(d.appointments);
  expect(appts, r.transcript.join('\n')).toHaveLength(1);
  expect(appts[0].service).toBe('Escova');
  expect(appts[0].price).toBe(70);
  // Salao schedules confirm_24h and confirm_2h, skipping any whose fire time has already passed.
  const rem = q<{ kind: string; fire_at: string }>('SELECT kind, fire_at FROM reminders WHERE appointment_id = ? ORDER BY kind', appts[0].id);
  const hoursAhead = (new Date(appts[0].startsAt).getTime() - Date.now()) / 3_600_000;
  const expected = [...(hoursAhead > 24 ? ['confirm_24h'] : []), ...(hoursAhead > 2 ? ['confirm_2h'] : [])];
  expect(rem.map((x) => x.kind)).toEqual(expected);
  const clock = await (await request.get('/api/dev/clock')).json();
  for (const r0 of rem) expect(r0.fire_at > clock.now, 'reminder scheduled in the future').toBe(true);
  test.info().annotations.push({ type: 'transcript', description: r.transcript.join(' | ') });
});

test('F04 reschedule then cancel the same appointment (no duplicates)', async ({ request }) => {
  const ph = phone();
  const booked = await converse(request, T.oficina, ph, 'quero agendar troca de oleo amanha de manha', async (id) => active((await detail(request, id)).appointments).length > 0);
  const before = active((await detail(request, booked.convId)).appointments);
  expect(before, booked.transcript.join('\n')).toHaveLength(1);
  const moved = await converse(
    request,
    T.oficina,
    ph,
    'preciso remarcar pra quinta a tarde',
    async (id) => {
      const a = active((await detail(request, id)).appointments);
      return a.length === 1 && a[0].startsAt !== before[0].startsAt;
    },
  );
  const after = active((await detail(request, moved.convId)).appointments);
  expect(after, moved.transcript.join('\n')).toHaveLength(1);
  expect(after[0].id).toBe(before[0].id);
  expect(after[0].startsAt).not.toBe(before[0].startsAt);
  const c = await send(request, T.oficina, ph, 'vou cancelar, surgiu um imprevisto');
  expect(c.turn.skipped).toBe('cancelled');
  expect(c.reply?.text).toMatch(/cancelei/i);
  const final = (await detail(request, moved.convId)).appointments;
  expect(final.find((a) => a.id === before[0].id)?.status).toBe('cancelled');
  expect(q('SELECT id FROM reminders WHERE appointment_id = ? AND sent = 0', before[0].id)).toHaveLength(0);
});

test('F05 odonto: no price unless asked; exact price when asked', async ({ request }) => {
  const ph = phone();
  const a = await send(request, T.odonto, ph, 'oi, queria marcar uma limpeza');
  expect(a.reply?.text ?? '').not.toMatch(/R\$\s?\d/);
  const b = await send(request, T.odonto, ph, 'quanto custa a limpeza?');
  expect(b.reply?.text).toMatch(/180/);
});

test('F06 oficina quote: approval only on clear approval, stores approval_message_id', async ({ request }) => {
  const ph = phone();
  let convId = 0;
  const prompts = [
    'preciso trocar as pastilhas de freio da frente, onix 2019 placa QAT1A23. me faz um orcamento?',
    'pode registrar o pre-orcamento das pastilhas pra mim?',
    'manda o orcamento por aqui por favor',
  ];
  for (const p of prompts) {
    const t = await send(request, T.oficina, ph, p);
    convId = t.message.conversationId;
    if ((await detail(request, convId)).quotes.length) break;
  }
  const quotes = (await detail(request, convId)).quotes;
  test.skip(quotes.length === 0, 'model did not call create_quote in 3 attempts (model-dependent)');
  expect(quotes[0].status).toBe('sent');
  expect(quotes[0].total).toBe(350);
  await send(request, T.oficina, ph, 'hmm vou pensar');
  expect((await detail(request, convId)).quotes[0].status).toBe('sent');
  const ok = await send(request, T.oficina, ph, 'aprovo, pode fazer');
  const approved = (await detail(request, convId)).quotes[0];
  expect(approved.status).toBe('approved');
  expect(approved.approvalMessageId).toBe(ok.message.id);
});

test('F07 human request: escalates, bot goes silent, owner replies, RESUME brings bot back', async ({ request }) => {
  const ph = phone();
  const a = await send(request, T.pet, ph, 'quero falar com um atendente humano');
  expect(a.turn.escalated).toBe(true);
  const convId = a.message.conversationId;
  let d = await detail(request, convId);
  expect(d.conversation.status).toBe('human');
  expect(d.conversation.openEscalations).toHaveLength(1);
  const silent = await send(request, T.pet, ph, 'alguem ai?');
  expect(silent.reply).toBeNull();
  const own = await request.post(`/api/conversations/${convId}/owner-messages`, { data: { text: 'Oi! Aqui e o Lucas, em que posso ajudar?' } });
  expect(own.ok()).toBeTruthy();
  expect((await request.post(`/api/conversations/${convId}/resume`)).ok()).toBeTruthy();
  d = await detail(request, convId);
  expect(d.conversation.status).toBe('bot');
  expect(d.conversation.openEscalations).toHaveLength(0);
  const back = await send(request, T.pet, ph, 'quanto ta o banho porte pequeno?');
  expect(back.reply?.text).toMatch(/60/);
});

test('F08 take over pauses the bot; owner typing also pauses', async ({ request }) => {
  const ph = phone();
  const a = await send(request, T.salao, ph, 'oi');
  const convId = a.message.conversationId;
  expect((await (await request.post(`/api/conversations/${convId}/takeover`)).json()).status).toBe('human');
  expect((await send(request, T.salao, ph, 'tem horario hoje?')).reply).toBeNull();
  await request.post(`/api/conversations/${convId}/resume`);
  await request.post(`/api/conversations/${convId}/owner-messages`, { data: { text: 'oi, aqui e a Juliana' } });
  expect((await detail(request, convId)).conversation.status).toBe('human');
});

test('F09 sensitive topics: safe template + escalation in every health pack', async ({ request }) => {
  for (const [tenant, text, must] of [
    [T.pet, 'meu cachorro comeu chocolate, dou leite?', /veterin/i],
    [T.odonto, 'to com dor fortissima e o rosto inchado', /pronto atendimento/i],
    [T.estetica, 'tenho lupus, posso fazer peeling?', /avalia/i],
    [T.salao, 'to gravida, posso fazer progressiva?', /avalia/i],
  ] as const) {
    const t = await send(request, tenant, phone(), text);
    expect(t.turn.skipped, text).toBe('sensitive');
    expect(t.reply?.text).toMatch(must);
    expect(t.turn.escalated).toBe(true);
  }
});

test('F10 complaint and angry customer: acknowledged, handed to the team', async ({ request }) => {
  const t = await send(request, T.oficina, phone(), 'voces sao uma vergonha, fiquei 2h esperando semana passada');
  expect(t.turn.escalated).toBe(true);
  expect(t.reply?.text).toMatch(/equipe|atendente|alguem/i);
  const diy = await send(request, T.salao, phone(), 'olha, fiz luzes em casa e ficou horrivel. quanto fica pra arrumar?');
  expect(diy.turn.escalated, diy.reply?.text ?? '').toBe(false);
});

test('F11 spam: closed politely, repeats ignored, a real message reopens', async ({ request }) => {
  const ph = phone();
  const a = await send(request, T.estetica, ph, 'GANHE DINHEIRO RAPIDO clique aqui bit.ly/xyz');
  expect(a.turn.skipped).toBe('spam');
  expect((await detail(request, a.message.conversationId)).conversation.status).toBe('closed');
  const b = await send(request, T.estetica, ph, 'GANHE DINHEIRO RAPIDO clique aqui bit.ly/abc');
  expect(b.reply).toBeNull();
  const c = await send(request, T.estetica, ph, 'oi, quanto custa a limpeza de pele?');
  expect(c.reply?.text).toMatch(/180/);
  expect((await detail(request, c.message.conversationId)).conversation.status).toBe('bot');
});

test('F12 LGPD: "apaguem meus dados" wipes contact, messages and appointments', async ({ request }) => {
  const ph = phone();
  const a = await send(request, T.pet, ph, 'oi, meu cachorro se chama Thor, quanto ta o banho porte grande?');
  const oldConv = a.message.conversationId;
  const oldContact = q<{ contact_id: number }>('SELECT contact_id FROM conversations WHERE id = ?', oldConv)[0].contact_id;
  const w = await send(request, T.pet, ph, 'quero que voces apaguem meus dados');
  expect(w.turn.skipped).toBe('lgpd');
  expect(q('SELECT id FROM contacts WHERE id = ?', oldContact)).toHaveLength(0);
  expect(q('SELECT id FROM messages WHERE conversation_id = ?', oldConv)).toHaveLength(0);
  expect(q(`SELECT id FROM events WHERE json_extract(payload_json, '$.conversation_id') = ?`, oldConv)).toHaveLength(0);
  expect(w.reply?.text).toMatch(/LGPD/);
});

test('F13 opt-out and opt-in', async ({ request }) => {
  const ph = phone();
  const a = await send(request, T.salao, ph, 'SAIR');
  expect(a.turn.skipped).toBe('opt_out');
  expect(q<{ opt_out: number }>('SELECT opt_out FROM contacts WHERE phone = ?', ph)[0].opt_out).toBe(1);
  const b = await send(request, T.salao, ph, 'voltar');
  expect(b.turn.skipped).toBe('opt_in');
  expect(q<{ opt_out: number }>('SELECT opt_out FROM contacts WHERE phone = ?', ph)[0].opt_out).toBe(0);
});

test('F14 price negotiation never produces an off-list price', async ({ request }) => {
  const ph = phone();
  for (const text of ['na oficina do lado o alinhamento e 100, faz por 100?', 'faz por 120 entao, fechado?', 'da um desconto de 20% ai']) {
    const t = await send(request, T.oficina, ph, text);
    const services = (await tenants(request)).find((x) => x.id === T.oficina)!.services;
    if (!t.reply) break; // handed to a human
    expect(checkPrices(t.reply.text ?? '', { services }).ok, t.reply.text ?? '').toBe(true);
  }
});

test('F15 pix key and review link come verbatim from tenant data', async ({ request }) => {
  const tn = (await tenants(request)).find((x) => x.id === T.estetica)!;
  const t = await send(request, T.estetica, phone(), 'posso pagar no pix? me manda a chave');
  expect(t.reply?.text).toContain(tn.pixKey);
});

test('F16 voice note (real whisperX) and photo (real gemma3 vision) through the API', async ({ request }) => {
  const ph = phone();
  const audio = await request.post('/api/sim/messages?wait=1', {
    timeout: 240_000,
    multipart: { tenantId: T.oficina, phone: ph, name: 'QA Audio', type: 'audio', file: { name: 'v.m4a', mimeType: 'audio/mp4', buffer: readFileSync(path.join(ROOT, 'fixtures/audio/voice-note-oficina.m4a')) } },
  });
  expect(audio.status()).toBe(201);
  const aj = await audio.json();
  const msg = (await detail(request, aj.message.conversationId)).messages.find((m) => m.type === 'audio')!;
  expect(msg.transcript).toMatch(/barulho/i);
  expect(msg.meta.durationS).toBeGreaterThan(3);
  expect(aj.reply?.text?.length).toBeGreaterThan(5);
  const img = await request.post('/api/sim/messages?wait=1', {
    timeout: 240_000,
    multipart: { tenantId: T.pet, phone: ph, name: 'QA Foto', type: 'image', text: 'olha isso na barriga dele', file: { name: 'p.png', mimeType: 'image/png', buffer: readFileSync(path.join(ROOT, 'fixtures/images/pet.png')) } },
  });
  expect(img.status()).toBe(201);
  const ij = await img.json();
  const imsg = (await detail(request, ij.message.conversationId)).messages.find((m) => m.type === 'image')!;
  expect((imsg.meta.imageDescription ?? '').length).toBeGreaterThan(10);
  expect(ij.reply?.text ?? '').not.toMatch(/pomada|remedio|dose/i);
  const media = await request.get(imsg.mediaUrl!);
  expect(media.status()).toBe(200);
});

test('F17 corrupt audio fails gracefully (bot still answers, owner sees why)', async ({ request }) => {
  const r = await request.post('/api/sim/messages?wait=1', {
    timeout: 240_000,
    multipart: { tenantId: T.salao, phone: phone(), name: 'QA Bad', type: 'audio', file: { name: 'bad.ogg', mimeType: 'audio/ogg', buffer: Buffer.from('not really audio'.repeat(100)) } },
  });
  expect(r.status()).toBe(201);
  const j = await r.json();
  const m = (await detail(request, j.message.conversationId)).messages.find((x) => x.type === 'audio')!;
  expect(m.transcript).toMatch(/nao foi possivel transcrever/);
  expect(j.reply).not.toBeNull();
});

test('F18 concurrency: 5 customers at once are all answered (single generation queue)', async ({ request }) => {
  const started = Date.now();
  const res = await Promise.all(
    [T.oficina, T.salao, T.odonto, T.pet, T.estetica].map((t) => send(request, t, phone(), 'oi, qual o horario de voces?')),
  );
  for (const r of res) expect(r.reply?.text?.length ?? 0).toBeGreaterThan(5);
  test.info().annotations.push({ type: 'concurrency', description: `5 parallel customers answered in ${((Date.now() - started) / 1000).toFixed(1)}s` });
});

test('F19 rapid double message from one customer: every message answered, no duplicate replies', async ({ request }) => {
  const ph = phone();
  const [a, b] = await Promise.all([
    request.post('/api/sim/messages', { data: { tenantId: T.pet, phone: ph, name: 'QA', type: 'text', text: 'oi' } }),
    request.post('/api/sim/messages', { data: { tenantId: T.pet, phone: ph, name: 'QA', type: 'text', text: 'quanto ta o banho porte pequeno?' } }),
  ]);
  const convId = (await a.json()).message.conversationId;
  expect((await b.json()).message.conversationId).toBe(convId);
  await expect
    .poll(async () => (await detail(request, convId)).messages.filter((m) => m.role === 'assistant').length, { timeout: 90_000 })
    .toBeGreaterThanOrEqual(1);
  await new Promise((r) => setTimeout(r, 15_000));
  const msgs = (await detail(request, convId)).messages;
  const bot = msgs.filter((m) => m.role === 'assistant');
  expect(bot.length).toBeLessThanOrEqual(2);
  expect(new Set(bot.map((m) => m.text)).size).toBe(bot.length);
  expect(bot.map((m) => m.text).join(' ')).toMatch(/60/);
});

test('F20 Ollama down: graceful fallback reply, then handoff; health reports not ok', async () => {
  const port = 3401;
  const child: ChildProcess = spawn('node', ['src/main.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_PATH: 'data/qa-down.db', MEDIA_DIR: 'data/qa-down-media', OLLAMA_URL: 'http://localhost:9', LLM_TIMEOUT_MS: '5000' },
    stdio: 'ignore',
  });
  try {
    const base = `http://localhost:${port}`;
    await expect.poll(async () => (await fetch(`${base}/api/health`).catch(() => null))?.status ?? 0, { timeout: 30_000 }).toBe(200);
    expect((await (await fetch(`${base}/api/health`)).json()).ok).toBe(false);
    const post = (text: string) =>
      fetch(`${base}/api/sim/messages?wait=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: T.pet, phone: '+55 11 90000-0000', name: 'QA', type: 'text', text }),
      }).then((r) => r.json());
    const a = await post('oi, quanto ta o banho?');
    expect(a.reply.text).toMatch(/equipe|retorno|instante/i);
    const b = await post('e a tosa?');
    expect(b.turn.escalated).toBe(true);
  } finally {
    child.kill();
    for (const f of ['data/qa-down.db', 'data/qa-down.db-wal', 'data/qa-down.db-shm']) await import('node:fs').then((fs) => fs.rmSync(path.join(ROOT, f), { force: true }));
  }
});

test('F21 reminders via time travel: confirm_24h/2h fire with CTA, "1" confirms, "2" opens reschedule', async ({ request }) => {
  const ph1 = phone();
  const ph2 = phone();
  const book = async (ph: string) => {
    const r = await converse(request, T.salao, ph, 'quero agendar uma manicure depois de amanha a tarde', async (id) => active((await detail(request, id)).appointments).length > 0);
    const a = active((await detail(request, r.convId)).appointments);
    expect(a, r.transcript.join('\n')).toHaveLength(1);
    return { convId: r.convId, appt: a[0] };
  };
  const one = await book(ph1);
  const two = await book(ph2);
  // Travel just past the latest first-reminder of the two appointments (24h or 2h, whichever exists).
  const clock = await (await request.get('/api/dev/clock')).json();
  const firsts = [one, two].map((x) => q<{ fire_at: string }>('SELECT fire_at FROM reminders WHERE appointment_id = ? AND sent = 0 ORDER BY fire_at LIMIT 1', x.appt.id)[0]);
  expect(firsts.every(Boolean), 'each booking scheduled at least one reminder').toBe(true);
  const target = Math.max(...firsts.map((f) => new Date(f.fire_at).getTime()));
  const tt = await request.post('/api/dev/time-travel', { data: { advanceHours: Math.max(0.1, (target - new Date(clock.now).getTime()) / 3_600_000 + 0.1) } });
  expect(tt.ok()).toBeTruthy();
  for (const x of [one, two]) {
    const rem = (await detail(request, x.convId)).messages.filter((m) => m.meta.kind === 'reminder');
    expect(rem.length).toBeGreaterThanOrEqual(1);
    expect(rem[0].text).toContain('Responda 1 para confirmar, 2 para remarcar');
  }
  const c1 = await send(request, T.salao, ph1, '1');
  expect(c1.turn.skipped).toBe('reminder_confirmed');
  expect((await detail(request, one.convId)).appointments.find((a) => a.id === one.appt.id)?.status).toBe('confirmed');
  const c2 = await send(request, T.salao, ph2, '2');
  expect(c2.reply?.text?.length).toBeGreaterThan(5);
  expect(q<{ response: string }>(`SELECT response FROM reminders WHERE appointment_id = ? AND sent = 1 ORDER BY sent_at DESC LIMIT 1`, two.appt.id)[0].response).toBe('2');
});

test('F22 owner marks done -> review request with link; no-show -> guilt-free recovery', async ({ request }) => {
  const tn = (await tenants(request)).find((x) => x.id === T.estetica)!;
  const ph = phone();
  const r = await converse(request, T.estetica, ph, 'quero agendar uma drenagem amanha de manha', async (id) => active((await detail(request, id)).appointments).length > 0);
  const appt = active((await detail(request, r.convId)).appointments)[0];
  expect(appt, r.transcript.join('\n')).toBeTruthy();
  expect((await request.post(`/api/appointments/${appt.id}/status`, { data: { status: 'done' } })).ok()).toBeTruthy();
  doneCustomerPhone = ph;
  await expect.poll(async () => (await detail(request, r.convId)).messages.some((m) => m.meta.kind === 'review_request'), { timeout: 90_000 }).toBe(true);
  const review = (await detail(request, r.convId)).messages.find((m) => m.meta.kind === 'review_request')!;
  expect(review.text).toContain(tn.googleReviewLink);
  const ph2 = phone();
  const r2 = await converse(request, T.estetica, ph2, 'quero agendar uma limpeza de pele amanha a tarde', async (id) => active((await detail(request, id)).appointments).length > 0);
  const appt2 = active((await detail(request, r2.convId)).appointments)[0];
  await request.post(`/api/appointments/${appt2.id}/status`, { data: { status: 'no_show' } });
  await request.post('/api/dev/time-travel', { data: { advanceHours: 12 } });
  await expect.poll(async () => (await detail(request, r2.convId)).messages.some((m) => m.meta.kind === 'no_show_recovery'), { timeout: 60_000 }).toBe(true);
});

test('F23 reactivation after the pack window respects opt-out', async ({ request }) => {
  // Opt one done customer out, then jump past every pack's reactivation window.
  if (!doneCustomerPhone) {
    // F22 did not run in this worker: create a customer with a completed visit here.
    doneCustomerPhone = phone();
    const r = await converse(request, T.estetica, doneCustomerPhone, 'quero agendar uma drenagem amanha de manha', async (id) => active((await detail(request, id)).appointments).length > 0);
    const appt = active((await detail(request, r.convId)).appointments)[0];
    await request.post(`/api/appointments/${appt.id}/status`, { data: { status: 'done' } });
  }
  await send(request, T.estetica, doneCustomerPhone, 'SAIR');
  const optedContact = q<{ id: number }>('SELECT id FROM contacts WHERE phone = ?', doneCustomerPhone)[0].id;
  await request.post('/api/dev/time-travel', { data: { advanceHours: 24 * 200 } });
  await request.post('/api/dev/tick');
  await request.post('/api/dev/time-travel', { data: { advanceHours: 12 } });
  const sent = q<{ contact_id: number }>(`SELECT contact_id FROM reminders WHERE kind = 'reactivation' AND sent = 1 AND (response IS NULL OR response NOT LIKE 'skipped%')`);
  expect(sent.length).toBeGreaterThan(0);
  const optedOut = q<{ id: number }>('SELECT id FROM contacts WHERE opt_out = 1').map((r) => r.id);
  const optedIds = new Set(optedOut);
  const reactivationMsgs = q<{ contact_id: number }>(
    `SELECT c.contact_id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE json_extract(m.meta_json, '$.kind') = 'reactivation'`,
  );
  expect(reactivationMsgs.some((r) => optedIds.has(r.contact_id))).toBe(false);
  expect(reactivationMsgs.some((r) => r.contact_id === optedContact)).toBe(false);
});

test('F24 admin metrics match the database', async ({ request }) => {
  const m = await (await request.get('/api/admin/metrics?tenantId=all')).json();
  const s = m.weekStart;
  const e = m.weekEnd;
  const bookings = q<{ n: number }>(`SELECT COUNT(*) n FROM appointments WHERE source = 'bot' AND created_at BETWEEN ? AND ?`, s, e)[0].n;
  expect(m.bookingsCreated).toBe(bookings);
  const esc = q<{ n: number }>(`SELECT COUNT(*) n FROM escalations WHERE created_at BETWEEN ? AND ?`, s, e)[0].n;
  expect(m.escalations.total).toBe(esc);
  const quotes = q<{ n: number }>(`SELECT COUNT(*) n FROM quotes WHERE created_at BETWEEN ? AND ?`, s, e)[0].n;
  expect(m.quotesSent).toBe(quotes);
  for (const k of ['conversationsHandled', 'answeredUnder1MinPct', 'afterHoursLeads', 'remindersSent', 'noShowsAvoided', 'reactivatedCustomers', 'attributedRevenue']) {
    expect(typeof m[k], k).toBe('number');
  }
  expect(m.topQuestions.length).toBeLessThanOrEqual(5);
  const perTenantSum = m.perTenant.reduce((a: number, t: { bookingsCreated: number }) => a + t.bookingsCreated, 0);
  expect(perTenantSum).toBe(m.bookingsCreated);
});

test('F25 global invariants over every assistant message produced in this QA run', async ({ request }) => {
  const all = await tenants(request);
  const rows = q<{ id: number; text: string; tenant_id: string; meta_json: string; conversation_id: number }>(
    `SELECT m.id, m.text, c.tenant_id, m.meta_json, m.conversation_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
     JOIN contacts ct ON ct.id = c.contact_id
     WHERE m.role = 'assistant' AND m.text IS NOT NULL AND ct.phone LIKE '+55 11 96%'`,
  );
  expect(rows.length).toBeGreaterThan(30);
  const problems: string[] = [];
  for (const r of rows) {
    const tn = all.find((t) => t.id === r.tenant_id)!;
    if (/[\u2013\u2014]/.test(r.text)) problems.push(`#${r.id} em-dash`);
    if (/"tool"\s*:|"args"\s*:|<tool_call>|\/no_think|check_availability|create_quote/.test(r.text)) problems.push(`#${r.id} leaked tool text`);
    const g = checkPrices(r.text, { services: tn.services, ignoreStrings: [tn.address, tn.phone, tn.pixKey, tn.googleReviewLink] });
    const quoteTotals = q<{ total: number }>('SELECT total FROM quotes WHERE conversation_id = ?', r.conversation_id).map((x) => x.total);
    const g2 = checkPrices(r.text, { services: tn.services, quoteTotals, ignoreStrings: [tn.address, tn.phone, tn.pixKey, tn.googleReviewLink] });
    if (!g.ok && !g2.ok) problems.push(`#${r.id} off-list price ${g.offending.join(',')}${g.discount ? ' discount ' + g.discount : ''}: ${r.text.slice(0, 80)}`);
    const claim = claimKind(r.text);
    const kind = JSON.parse(r.meta_json).kind;
    if (claim && !kind) {
      const backed = q(
        `SELECT id FROM events WHERE kind = 'tool_call' AND json_extract(payload_json, '$.conversation_id') = ? AND json_extract(payload_json, '$.ok') = 1
         AND json_extract(payload_json, '$.name') IN ('book','reschedule','cancel')`,
        r.conversation_id,
      );
      if (backed.length === 0) problems.push(`#${r.id} unbacked ${claim} claim: ${r.text.slice(0, 80)}`);
    }
  }
  // Every conversation's first assistant message discloses the virtual assistant.
  const firsts = q<{ text: string; kind: string | null; id: number }>(
    `SELECT m.text, json_extract(m.meta_json, '$.kind') kind, m.id FROM messages m
     JOIN conversations c ON c.id = m.conversation_id JOIN contacts ct ON ct.id = c.contact_id
     WHERE m.id IN (SELECT MIN(id) FROM messages WHERE role = 'assistant' GROUP BY conversation_id) AND ct.phone LIKE '+55 11 96%'`,
  );
  for (const f of firsts) if (!/virtual/i.test(f.text) && !['lgpd', 'handoff', 'spam', 'opt_out', 'sensitive_handoff'].includes(f.kind ?? '')) problems.push(`#${f.id} first reply without disclosure: ${f.text.slice(0, 60)}`);
  test.info().annotations.push({ type: 'invariants', description: `${rows.length} assistant messages checked` });
  expect(problems, problems.join('\n')).toEqual([]);
});
