import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, type ToolContext } from '../src/engine/tools.ts';
import { getPack } from '../src/packs/packs.ts';
import { OFICINA, SALAO, ScriptedLLM, reply, testKani } from './helpers.ts';
import type { Kani } from '../src/app.ts';

function ctxFor(k: Kani, tenantId: string, phone = '+55 11 91111-0000'): ToolContext {
  const tenant = k.repo.getTenant(tenantId)!;
  const contact = k.repo.upsertContact(tenantId, phone, 'Teste');
  const conversation = k.repo.getOrCreateConversation(tenantId, contact.id);
  return { repo: k.repo, clock: k.clock, tenant, pack: getPack(tenant.packId), contact, conversation };
}

test('tools: book() creates an appointments row with reminders', async () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const ctx = ctxFor(k, SALAO);
  const res = await executeTool(ctx, 'book', { contact: { name: 'Carla' }, service: 'Corte feminino', slot: '2026-10-07 15:00', staff: 'Juliana' });
  assert.equal(res.ok, true, JSON.stringify(res));
  const appts = k.repo.appointmentsForContact(ctx.contact.id);
  assert.equal(appts.length, 1);
  assert.equal(appts[0].service, 'Corte feminino');
  assert.equal(appts[0].staff, 'Juliana');
  assert.equal(appts[0].status, 'booked');
  assert.equal(appts[0].price, 90);
  const kinds = k.repo.remindersForAppointment(appts[0].id).map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['confirm_24h', 'confirm_2h'], 'salao pack schedules both confirmations');
  assert.equal(k.repo.getContact(ctx.contact.id)!.profile.nome, 'Carla');
});

test('tools: double-booking the same staff and slot is rejected', async () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const a = ctxFor(k, SALAO, '+55 11 91111-0001');
  const b = ctxFor(k, SALAO, '+55 11 91111-0002');
  const first = await executeTool(a, 'book', { service: 'Escova', slot: '2026-10-07 10:00', staff: 'Rafael' });
  assert.equal(first.ok, true);
  const second = await executeTool(b, 'book', { service: 'Corte masculino', slot: '2026-10-07 10:00', staff: 'Rafael' });
  assert.equal(second.ok, false);
  assert.match(String(second.error), /indisponivel/);
  assert.ok(Array.isArray(second.alternativas));
  assert.equal(k.repo.appointmentsForContact(b.contact.id).length, 0);
});

test('tools: slot capacity follows staff count when the pack does not need a specific staff', async () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const slot = { service: 'Troca de oleo + filtro', slot: '2026-10-07 09:00' };
  assert.equal((await executeTool(ctxFor(k, OFICINA, '+55 11 1'), 'book', slot)).ok, true);
  assert.equal((await executeTool(ctxFor(k, OFICINA, '+55 11 2'), 'book', slot)).ok, true);
  const third = await executeTool(ctxFor(k, OFICINA, '+55 11 3'), 'book', slot);
  assert.equal(third.ok, false, 'both mechanics are busy');
});

test('tools: availability excludes booked slots, closed days and past times', async () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const ctx = ctxFor(k, SALAO);
  await executeTool(ctx, 'book', { service: 'Corte feminino', slot: '2026-10-07 09:00', staff: 'Juliana' });
  const res = (await executeTool(ctx, 'check_availability', {
    service: 'Corte feminino',
    date_from: '2026-10-07',
    date_to: '2026-10-07',
    staff: 'Juliana',
  })) as { ok: boolean; slots: { slot: string }[] };
  assert.equal(res.ok, true);
  assert.ok(res.slots.length > 0);
  assert.ok(!res.slots.some((s) => s.slot === '2026-10-07 09:00'));
  const sunday = (await executeTool(ctx, 'check_availability', { service: 'Escova', date_from: '2026-10-11', date_to: '2026-10-11' })) as unknown as {
    slots: { slot: string }[];
  };
  assert.ok(sunday.slots.every((s) => !s.slot.startsWith('2026-10-11')), 'closed on Sunday');
});

test('tools: create_quote only accepts list items and computes the total', async () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const ctx = ctxFor(k, OFICINA);
  const ok = await executeTool(ctx, 'create_quote', { items: [{ service: 'Alinhamento e balanceamento' }, { service: 'Diagnostico com scanner' }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.total, 280);
  const bad = await executeTool(ctx, 'create_quote', { items: [{ service: 'Troca de embreagem' }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.itens_fora_da_lista, ['Troca de embreagem']);
});

test('tools: reschedule and cancel act on the contact appointment', async () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const ctx = ctxFor(k, OFICINA);
  const booked = await executeTool(ctx, 'book', { service: 'Revisao basica', slot: '2026-10-07 08:00' });
  const moved = await executeTool(ctx, 'reschedule', { slot: '2026-10-08 13:00' });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(k.repo.getAppointment(Number(booked.appointment_id))!.startsAt, new Date('2026-10-08T16:00:00Z').toISOString());
  const cancelled = await executeTool(ctx, 'cancel', {});
  assert.equal(cancelled.ok, true);
  assert.equal(k.repo.getAppointment(Number(booked.appointment_id))!.status, 'cancelled');
  assert.equal(k.repo.remindersForAppointment(Number(booked.appointment_id)).filter((r) => !r.sent).length, 0);
});

test('tools: book during a reschedule conversation moves the existing appointment instead of duplicating', async () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const ctx = ctxFor(k, OFICINA);
  const first = await executeTool(ctx, 'book', { service: 'Revisao basica', slot: '2026-10-07 08:00' });
  const res = await executeTool({ ...ctx, recentCustomerText: 'preciso remarcar minha revisao' }, 'book', {
    service: 'Revisao basica',
    slot: '2026-10-08 13:00',
  });
  assert.equal(res.ok, true);
  assert.equal(res.converted_from, 'book');
  const active = k.repo.appointmentsForContact(ctx.contact.id).filter((a) => a.status === 'booked');
  assert.equal(active.length, 1);
  assert.equal(active[0].id, Number(first.appointment_id));
});

test('tools: schema-wrapped arguments from prompted-JSON models are unwrapped', async () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const ctx = ctxFor(k, SALAO);
  const res = await executeTool(ctx, 'book', {
    contact: { name: { type: 'string', description: 'Nome', value: 'Luciana' } },
    service: { value: 'Escova' },
    slot: { type: 'string', value: '2026-10-07 10:00' },
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(k.repo.getContact(ctx.contact.id)!.profile.nome, 'Luciana');
});
