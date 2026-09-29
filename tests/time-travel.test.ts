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
