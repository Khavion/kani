import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimKind, matchOfferedSlot } from '../src/engine/engine.ts';
import { parseTextToolCalls } from '../src/engine/llm.ts';
import { composeSystemPrompt } from '../src/engine/prompt.ts';
import { stripDashes } from '../src/util/text.ts';
import { getPack } from '../src/packs/packs.ts';
import { OFICINA, ODONTO, SALAO, ScriptedLLM, reply, say, testKani } from './helpers.ts';

test('engine: tool loop is capped at 4 rounds, then forces a final answer', async () => {
  const llm = new ScriptedLLM((req) =>
    req.tools ? { toolCalls: [{ name: 'check_availability', arguments: { service: 'Escova' } }] } : { content: 'Tenho horarios amanha!' },
  );
  const k = testKani(llm);
  const { turn } = await say(k, SALAO, 'tem horario pra escova?');
  assert.equal(turn.toolCalls.length, 4);
  assert.equal(llm.requests.length, 5);
  assert.equal(llm.requests[4].tools, undefined, 'final call has no tools');
  assert.match(turn.reply!.text!, /Tenho horarios/);
});

test('engine: base prompt is composed verbatim with persona, pack, tenant and memory', () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const tenant = k.repo.getTenant(SALAO)!;
  const contact = k.repo.upsertContact(SALAO, '+55 11 9', 'Ana');
  k.repo.setMemorySummary(contact.id, 'Prefere a Juliana aos sabados.');
  const conv = k.repo.getOrCreateConversation(SALAO, contact.id);
  const ctx = k.engine.buildPromptContext(conv, tenant, getPack('salao'), contact, []);
  const sys = composeSystemPrompt(ctx);
  assert.ok(sys.startsWith('Voce e a recepcionista virtual do Studio Bela Pinheiros, simpatica, agil, tom leve. Fale portugues brasileiro natural, curto, caloroso.'));
  assert.ok(sys.includes('(6) Nunca use travessao.'));
  assert.ok(sys.includes('- Corte feminino: R$90'));
  assert.ok(sys.includes('Prefere a Juliana aos sabados.'));
  assert.ok(sys.includes('c1d9e4b2-8a7f-4e3c-b6d1-5f2a9c0e7b48'), 'tenant pix key');
  assert.ok(sys.includes('seg a sab 9h-19h'), 'hours FAQ replaced by tenant hours');
  assert.ok(!sys.includes('Ter a sab'), 'stale pack FAQ hours removed');
});

test('engine: explicit request for a human pauses the bot without calling the LLM', async () => {
  const llm = new ScriptedLLM(reply('nao deveria ser chamado'));
  const k = testKani(llm);
  const { turn } = await say(k, OFICINA, 'quero falar com um atendente humano');
  assert.equal(llm.requests.length, 0);
  assert.equal(turn.escalated, true);
  assert.equal(k.repo.getConversation(turn.conversationId)!.status, 'human');
});

test('engine: TAKE OVER pauses the bot; RESUME re-enables it', async () => {
  const llm = new ScriptedLLM(reply('Oi! Como posso ajudar?'));
  const k = testKani(llm);
  const first = await say(k, OFICINA, 'oi');
  const convId = first.turn.conversationId;
  k.engine.takeOver(convId);
  const paused = await say(k, OFICINA, 'alguem ai?');
  assert.equal(paused.turn.skipped, 'human');
  assert.equal(llm.requests.length, 1);
  await k.engine.ownerMessage(convId, 'Oi, aqui e o Marcos da oficina!');
  k.engine.resume(convId);
  const back = await say(k, OFICINA, 'valeu marcos');
  assert.ok(back.turn.reply);
  assert.equal(llm.requests.length, 2);
  const roles = k.repo.listMessages(convId).map((m) => m.role);
  assert.ok(roles.includes('owner'));
});

test('engine: sensitive topic gets one safe templated reply (no LLM) and then auto-pauses', async () => {
  const llm = new ScriptedLLM(reply('A progressiva e possivel sim!'));
  const k = testKani(llm);
  const { turn } = await say(k, ODONTO, 'to com dor fortissima e inchado');
  assert.equal(llm.requests.length, 0);
  assert.match(turn.reply!.text!, /pronto atendimento/);
  assert.equal(turn.escalated, true);
  assert.equal(k.repo.getConversation(turn.conversationId)!.status, 'human');
});

test('engine: two consecutive low-confidence turns pause the bot', async () => {
  const k = testKani(new ScriptedLLM(reply('Nao tenho certeza, preciso confirmar.')));
  await say(k, OFICINA, 'voces fazem cambio automatico?');
  const { turn } = await say(k, OFICINA, 'e embreagem?');
  assert.equal(turn.escalated, true);
  assert.match(k.repo.escalationsForConversation(turn.conversationId)[0].reason, /baixa confianca/);
});

test('engine: first contact discloses the virtual assistant once; no em-dashes reach the customer', async () => {
  const k = testKani(new ScriptedLLM(reply('Boa noite! A troca de oleo + filtro sai R$180 \u2014 quer agendar?')));
  const first = await say(k, OFICINA, 'qnto ta a troca?');
  assert.match(first.turn.reply!.text!, /assistente virtual do Auto Center Vila Mariana/);
  assert.doesNotMatch(first.turn.reply!.text!, /[\u2013\u2014]/);
  const second = await say(k, OFICINA, 'e o alinhamento?');
  assert.doesNotMatch(second.turn.reply!.text!, /assistente virtual/);
  assert.equal(stripDashes('a \u2014 b'), 'a, b');
});

test('engine: LGPD "esquecer meus dados" wipes the contact', async () => {
  const k = testKani(new ScriptedLLM(reply('Oi!')));
  const { turn } = await say(k, OFICINA, 'oi, meu carro e um onix placa ABC1D23');
  const before = k.repo.getConversation(turn.conversationId)!;
  k.repo.mergeContactProfile(before.contactId, { placa: 'ABC1D23' });
  const wipe = await say(k, OFICINA, 'quero que voces esquecam meus dados');
  assert.equal(wipe.turn.skipped, 'lgpd');
  assert.equal(k.repo.getContact(before.contactId), null);
  assert.equal(k.repo.listMessages(before.id).length, 0);
  const fresh = k.repo.findContact(OFICINA, '+55 11 90000-1111')!;
  assert.deepEqual(fresh.profile, {});
  assert.match(k.repo.listMessages(wipe.turn.conversationId)[0].text!, /LGPD/);
});

test('engine: oficina quote is approved only on clear approval and stores the message id', async () => {
  let n = 0;
  const llm = new ScriptedLLM((req) => {
    n++;
    if (n === 1 && req.tools) return { toolCalls: [{ name: 'create_quote', arguments: { items: [{ service: 'Pastilhas de freio (dianteira, par)' }] } }] };
    return { content: 'Pre-orcamento: Pastilhas de freio R$350. Se aprovar, responda "aprovo".' };
  });
  const k = testKani(llm);
  const { turn } = await say(k, OFICINA, 'quero trocar as pastilhas da frente');
  const quote = k.repo.quotesForConversation(turn.conversationId)[0];
  assert.equal(quote.status, 'sent');
  await say(k, OFICINA, 'vou pensar');
  assert.equal(k.repo.getQuote(quote.id)!.status, 'sent');
  const ok = await say(k, OFICINA, 'aprovo, pode fazer');
  const approved = k.repo.getQuote(quote.id)!;
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvalMessageId, ok.res.message.id);
});

test('engine: spam is closed politely without tools', async () => {
  const llm = new ScriptedLLM(reply('x'));
  const k = testKani(llm);
  const { turn } = await say(k, OFICINA, 'GANHE DINHEIRO RAPIDO clique aqui bit.ly/xyz');
  assert.equal(turn.skipped, 'spam');
  assert.equal(llm.requests.length, 0);
  assert.equal(k.repo.getConversation(turn.conversationId)!.status, 'closed');
});

test('engine: an unbacked "agendado" claim is repaired into a confirmation question', async () => {
  let call = 0;
  const llm = new ScriptedLLM((req) => {
    call++;
    if (call === 1 && req.tools) return { toolCalls: [{ name: 'check_availability', arguments: { service: 'Escova', date_from: '2026-10-07', date_to: '2026-10-07' } }] };
    return { content: 'Agendado para qua 07/10 às 09:00!' };
  });
  const k = testKani(llm);
  const { turn } = await say(k, SALAO, 'quero escova amanha as 9h');
  assert.match(turn.reply!.text!, /Só pra confirmar: posso agendar Escova para qua 07\/10 às 09:00\?/);
  const contactId = k.repo.getConversation(turn.conversationId)!.contactId;
  assert.equal(k.repo.appointmentsForContact(contactId).length, 0);
  // "pode sim" executes the confirmed action deterministically.
  const calls = llm.requests.length;
  const yes = await say(k, SALAO, 'pode sim!');
  assert.equal(yes.turn.skipped, 'confirmed_action');
  assert.equal(llm.requests.length, calls, 'no model call needed');
  const appts = k.repo.appointmentsForContact(contactId);
  assert.equal(appts.length, 1);
  assert.equal(appts[0].service, 'Escova');
  assert.match(yes.turn.reply!.text!, /Agendado/);
  assert.equal(claimKind('Seu horário foi cancelado.'), 'cancel');
  assert.equal(claimKind('Quer que eu deixe agendado?'), null);
  assert.equal(claimKind('Entendo, ja cancelei seu agendamento de amanha.'), 'cancel');
  assert.equal(claimKind('Pronto, remarquei para quinta.'), 'reschedule');
  assert.equal(claimKind('Agendei pra voce!'), 'book');
  assert.deepEqual(matchOfferedSlot(['as 9h'], { service: 'x', slots: [{ slot: '2026-10-07 09:00', label: 'qua 07/10 às 09:00' }] })?.slot, '2026-10-07 09:00');
});

test('llm: prompted tool calls are parsed from text for models without native tools', () => {
  const known = new Set(['book', 'check_availability']);
  const a = parseTextToolCalls('{"tool": "check_availability", "args": {"service": "Escova"}}', known);
  assert.equal(a.calls[0].name, 'check_availability');
  const b = parseTextToolCalls('<tool_call>{"name": "book", "arguments": {"slot": "2026-10-07 10:00"}}</tool_call>', known);
  assert.equal(b.calls[0].arguments.slot, '2026-10-07 10:00');
  const c = parseTextToolCalls('Oi! Tudo bem?', known);
  assert.equal(c.calls.length, 0);
});

test('engine: models without native tools use the prompted JSON protocol', async () => {
  let i = 0;
  const llm = new ScriptedLLM(
    () => {
      i++;
      return i === 1 ? { content: '{"tool": "check_availability", "args": {"service": "Escova"}}' } : { content: 'Tenho amanha as 9h ou 10h!' };
    },
    { tools: false },
  );
  const k = testKani(llm);
  const { turn } = await say(k, SALAO, 'tem horario pra escova?');
  assert.equal(turn.toolCalls[0].name, 'check_availability');
  assert.equal(llm.requests[0].tools, undefined);
  assert.match(llm.requests[0].messages[0].content, /PROTOCOLO: para usar uma ferramenta/);
  assert.match(llm.requests[1].messages.at(-1)!.content, /RESULTADO DA FERRAMENTA check_availability/);
});

test('engine: disclosure replaces a model-written self introduction instead of splicing into it', () => {
  const k = testKani(new ScriptedLLM(reply('')));
  const tenant = k.repo.getTenant('estetica-itaim')!;
  const pack = getPack('estetica');
  const conv = { disclosed: false } as never;
  const a = k.engine.ensureDisclosure('Oi, sou a Essenza Estetica Itaim. A drenagem custa R$140.', conv, pack, tenant);
  assert.equal(a, 'Oi! Eu sou a consultora virtual da Essenza Estetica Itaim. A drenagem custa R$140.');
  const b = k.engine.ensureDisclosure('Boa noite, Carla! A drenagem custa R$140.', conv, pack, tenant);
  assert.equal(b, 'Boa noite, Carla! Eu sou a consultora virtual da Essenza Estetica Itaim. A drenagem custa R$140.');
  const c = k.engine.ensureDisclosure('A drenagem custa R$140.', conv, pack, tenant);
  assert.equal(c, 'Oi! Eu sou a consultora virtual da Essenza Estetica Itaim. A drenagem custa R$140.');
});

test('policy: anger detection ignores ordinary "nunca mais" and catches churn threats', async () => {
  const { isAngry } = await import('../src/engine/policy.ts');
  assert.equal(isAngry('nunca mais vou conseguir hoje, preciso de outro dia'), false);
  assert.equal(isAngry('nunca mais volto nessa oficina'), true);
  assert.equal(isAngry('voces sao uma vergonha'), true);
  assert.equal(isAngry('responde logo pqp'), false);
});

test('cleanReply: repairs a price glued to a duration', async () => {
  const { cleanReply } = await import('../src/engine/engine.ts');
  assert.equal(cleanReply('A vacina antirrabica custa R$90,15 min.'), 'A vacina antirrabica custa R$90 (15 min).');
  assert.equal(cleanReply('Sai R$ 99,90 no total'), 'Sai R$ 99,90 no total');
});

test('engine: a promised handoff always creates a real escalation; complaints are caught', async () => {
  const { isComplaint, promisesHandoff } = await import('../src/engine/policy.ts');
  assert.equal(isComplaint('voces acabaram com meu cabelo, cortaram tudo torto'), true);
  assert.equal(isComplaint('quero agendar um corte'), false);
  assert.equal(isComplaint('olha isso, fiz em casa e ficou horrivel. qnto fica pra arrumar?'), false);
  assert.equal(isComplaint('o corte que voces fizeram ficou horrivel'), true);
  assert.equal(promisesHandoff('Vou chamar alguem da equipe pra te ajudar.'), true);
  assert.equal(promisesHandoff('Posso ver um horario pra voce?'), false);
  const k = testKani(new ScriptedLLM(reply('Entendi! Vou passar pra equipe verificar isso.')));
  const { turn } = await say(k, SALAO, 'voces cobram taxa de cancelamento?');
  assert.equal(turn.escalated, true);
  assert.match(k.repo.escalationsForConversation(turn.conversationId)[0].reason, /prometeu/);
});

test('cleanReply: strips invented assistant names', async () => {
  const { cleanReply } = await import('../src/engine/engine.ts');
  assert.equal(cleanReply('Olá! Sou a Bela, assistente virtual do Studio.'), 'Olá! Sou a assistente virtual do Studio.');
  assert.equal(cleanReply('Oi! Sou a Ana, sua recepcionista virtual.'), 'Oi! Sou a recepcionista virtual.');
  assert.equal(cleanReply('Sou a assistente virtual.'), 'Sou a assistente virtual.');
});

test('isAffirmative recognises short confirmations only', async () => {
  const { isAffirmative } = await import('../src/engine/engine.ts');
  for (const t of ['sim', 'pode sim, blz!', 'Confirmo', 'fechado', 'ok']) assert.equal(isAffirmative(t), true, t);
  for (const t of ['nao, prefiro outro dia', 'qual o valor?', 'sim nao sei', 'confirma, mas preciso mudar pra outro dia']) assert.equal(isAffirmative(t), false, t);
});

test('cleanReply strips leaked /no_think control tokens', async () => {
  const { cleanReply } = await import('../src/engine/engine.ts');
  assert.equal(cleanReply('Claro, posso ajudar /no_think'), 'Claro, posso ajudar');
});
