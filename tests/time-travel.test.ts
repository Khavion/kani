import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server/http.ts';
import { executeTool } from '../src/engine/tools.ts';
import { getPack } from '../src/packs/packs.ts';
import { REMINDER_CTA } from '../src/engine/templates.ts';
import { OFICINA, ScriptedLLM, reply, say, testKani } from './helpers.ts';

test('time travel: advancing 24h fires the confirm_24h reminder (sent=true)', async () => {
  const k = testKani(new ScriptedLLM(reply('ok')));
  const app = await buildServer(k);
  const tenant = k.repo.getTenant(OFICINA)!;
  const contact = k.repo.upsertContact(OFICINA, '+55 11 92222-0000', 'Bruno');
  const conversation = k.repo.getOrCreateConversation(OFICINA, contact.id);
  // Tuesday 10:00 now; book Wednesday 16:00 (30h ahead) -> confirm_24h fires Tuesday 16:00.
  const res = await executeTool(
    { repo: k.repo, clock: k.clock, tenant, pack: getPack('oficina'), contact, conversation },
    'book',
    { service: 'Troca de oleo + filtro', slot: '2026-10-07 16:00' },
  );
  assert.equal(res.ok, true);
  const apptId = Number(res.appointment_id);
  const rem = k.repo.remindersForAppointment(apptId).find((r) => r.kind === 'confirm_24h')!;
  assert.equal(rem.sent, false);

  const tt = await app.inject({ method: 'POST', url: '/api/dev/time-travel', payload: { advanceHours: 24 } });
  assert.equal(tt.statusCode, 200);
  assert.ok(tt.json().fired >= 1);
  const after = k.repo.getReminder(rem.id)!;
  assert.equal(after.sent, true);
  const msgs = k.repo.listMessages(conversation.id);
  const reminderMsg = msgs.find((m) => m.meta.kind === 'reminder');
  assert.ok(reminderMsg, 'reminder message was sent to the customer');
  assert.ok(reminderMsg!.text!.includes(REMINDER_CTA));

  // Customer answers "1": appointment confirmed, deterministic reply, no LLM involved.
  const { turn } = await say(k, OFICINA, '1', '+55 11 92222-0000', 'Bruno');
  assert.equal(turn.skipped, 'reminder_confirmed');
  assert.equal(k.repo.getAppointment(apptId)!.status, 'confirmed');
  assert.equal(k.repo.getReminder(rem.id)!.response, '1');
  await app.close();
});

test('time travel: "2" on a reminder opens the reschedule flow', async () => {
  const llm = new ScriptedLLM(reply('Claro! Qual dia fica melhor pra voce?'));
  const k = testKani(llm);
  const tenant = k.repo.getTenant(OFICINA)!;
  const contact = k.repo.upsertContact(OFICINA, '+55 11 92222-0001', 'Duda');
  const conversation = k.repo.getOrCreateConversation(OFICINA, contact.id);
  await executeTool({ repo: k.repo, clock: k.clock, tenant, pack: getPack('oficina'), contact, conversation }, 'book', {
    service: 'Revisao basica',
    slot: '2026-10-07 14:00',
  });
  await k.scheduler.timeTravel(24);
  const { turn } = await say(k, OFICINA, '2', '+55 11 92222-0001', 'Duda');
  assert.equal(turn.skipped, undefined, 'goes to the LLM with a reschedule note');
  const system = llm.requests.at(-1)!.messages[0].content;
  assert.match(system, /quer REMARCAR o agendamento/);
  const rem = k.repo.remindersForContact(contact.id).find((r) => r.kind === 'confirm_24h')!;
  assert.equal(rem.response, '2');
});

test('reactivation respects opt-out', async () => {
  const k = testKani(new ScriptedLLM(reply('ok')));
  const tenant = k.repo.getTenant(OFICINA)!;
  const mk = (phone: string, optOut: boolean) => {
    const c = k.repo.upsertContact(OFICINA, phone, 'X');
    k.repo.insertAppointment({
      tenantId: tenant.id,
      contactId: c.id,
      service: 'Revisao basica',
      staff: 'Marcos',
      startsAt: new Date(k.clock.now().getTime() - 200 * 86_400_000).toISOString(),
      endsAt: new Date(k.clock.now().getTime() - 200 * 86_400_000 + 3_600_000).toISOString(),
      status: 'done',
      price: 420,
    });
    if (optOut) k.repo.setOptOut(c.id, true);
    return c;
  };
  const active = mk('+55 11 93333-0001', false);
  const opted = mk('+55 11 93333-0002', true);
  await k.scheduler.tick();
  await k.scheduler.timeTravel(1);
  assert.equal(k.repo.remindersForContact(active.id).filter((r) => r.kind === 'reactivation' && r.sent).length, 1);
  assert.equal(k.repo.remindersForContact(opted.id).filter((r) => r.kind === 'reactivation').length, 0);
});

test('stale reminders for appointments that already started are skipped, not sent', async () => {
  const k = testKani(new ScriptedLLM(reply('ok')));
  const c = k.repo.upsertContact(OFICINA, '+55 11 94444-0000', 'Late');
  const start = new Date(k.clock.now().getTime() - 3_600_000);
  const appt = k.repo.insertAppointment({
    tenantId: OFICINA, contactId: c.id, service: 'Revisao basica', staff: 'Marcos',
    startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString(), status: 'booked', price: 420,
  });
  const rem = k.repo.insertReminder({ appointmentId: appt.id, tenantId: OFICINA, contactId: c.id, fireAt: new Date(start.getTime() - 86_400_000).toISOString(), kind: 'confirm_24h' });
  await k.scheduler.tick();
  assert.equal(k.repo.getReminder(rem.id)!.response, 'skipped_stale');
  assert.equal(k.repo.listMessages(k.repo.getOrCreateConversation(OFICINA, c.id).id).length, 0);
});

test('http: only published reports are served; internals are not', async () => {
  const k = testKani(new ScriptedLLM(reply('ok')));
  const app = await buildServer(k);
  const { readdirSync } = await import('node:fs');
  const html = readdirSync(k.cfg.reportsDir).find((f) => f.endsWith('.html'));
  if (html) assert.equal((await app.inject({ url: `/reports/${html}` })).statusCode, 200);
  assert.notEqual((await app.inject({ url: '/reports/tmp/anything.db' })).statusCode, 200);
  assert.notEqual((await app.inject({ url: '/reports/qa/results.json' })).statusCode, 200);
  await app.close();
});

test('http: UI assets added after startup are served (rebuild without restart); missing assets 404', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const dist = mkdtempSync(pathMod.join(os.tmpdir(), 'kani-ui-'));
  writeFileSync(pathMod.join(dist, 'index.html'), '<!doctype html><title>Kani</title><script type="module" src="/assets/a.js"></script>');
  mkdirSync(pathMod.join(dist, 'assets'));
  const k = testKani(new ScriptedLLM(reply('ok')));
  k.cfg.uiDist = dist;
  const app = await buildServer(k);
  writeFileSync(pathMod.join(dist, 'assets', 'new-hash.js'), 'console.log(1)');
  const js = await app.inject({ url: '/assets/new-hash.js' });
  assert.equal(js.statusCode, 200);
  assert.match(String(js.headers['content-type']), /javascript/);
  assert.equal((await app.inject({ url: '/assets/gone.js' })).statusCode, 404);
  const spa = await app.inject({ url: '/admin' });
  assert.equal(spa.statusCode, 200);
  assert.match(String(spa.headers['content-type']), /html/);
  assert.equal(spa.headers['cache-control'], 'no-cache');
  await app.close();
});

test('http: the root URL serves the app shell', async () => {
  const k = testKani(new ScriptedLLM(reply('ok')));
  const app = await buildServer(k);
  const root = await app.inject({ url: '/' });
  if (root.statusCode !== 200 || !/html/.test(String(root.headers['content-type']))) {
    // ui/dist may be absent in a fresh checkout; then the server explains how to build it.
    assert.match(root.body, /Kani/);
  } else {
    assert.match(root.body, /<title>Kani/);
  }
  assert.notEqual(root.statusCode, 403);
  await app.close();
});
