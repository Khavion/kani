import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_REPLY, checkPrices, extractPrices } from '../src/engine/guard.ts';
import { getPack } from '../src/packs/packs.ts';
import { OFICINA, ODONTO, ScriptedLLM, reply, say, testKani } from './helpers.ts';

const oficina = getPack('oficina').services;
const estetica = getPack('estetica').services;

test('guard: "sai por R$199" with 199 not in services is blocked, escalated and logged', async () => {
  const k = testKani(new ScriptedLLM(reply('A troca de oleo sai por R$199, quer agendar?')));
  const { turn } = await say(k, OFICINA, 'qnto ta a troca de oleo?');
  assert.equal(turn.guardTriggered, true);
  assert.ok(turn.reply!.text!.toLowerCase().endsWith(GUARD_REPLY), turn.reply?.text ?? '');
  assert.doesNotMatch(turn.reply!.text!, /199/);
  assert.equal(turn.escalated, true);
  const conv = k.repo.getConversation(turn.conversationId)!;
  assert.equal(conv.status, 'human', 'escalation pauses the bot');
  const esc = k.repo.escalationsForConversation(conv.id);
  assert.equal(esc.length, 1);
  assert.match(esc[0].reason, /199/);
  const events = k.repo.events({ kind: 'guard_violation' });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload.offending, [199]);
  assert.equal(turn.reply?.meta.rawText, 'A troca de oleo sai por R$199, quer agendar?');
});

test('guard: list prices, derived installments and non-price numerals pass', () => {
  const ok = (t: string, services = oficina) => assert.equal(checkPrices(t, { services }).ok, true, t);
  ok('A troca de oleo + filtro sai R$180 com oleo semissintetico.');
  ok('Alinhamento e balanceamento custa R$ 160,00.');
  ok('Seg a sex 8h-18h, sab 8h-12h. Servicos tem 90 dias de garantia.');
  ok('Tenho qua 07/10 às 11:30 ou às 14:00, qual prefere?');
  ok('Troca de bateria (60Ah instalada) por R$520.');
  ok('A revisao do seu Onix 2019 sai R$420.');
  ok('Pacote 10 drenagens por R$1.200, ou 6x de R$200 no cartao.', estetica);
  ok('Te espero as 10 amanha!');
  ok('Duas sessoes de laser na axila ficam R$240.', estetica);
});

test('guard: bare price-like numerals and off-list values are caught', () => {
  assert.deepEqual(checkPrices('O alinhamento fica 155 reais', { services: oficina }).offending, [155]);
  assert.equal(checkPrices('A higienizacao do ar sai 150 reais', { services: oficina }).ok, true, '150 is a list price');
  assert.deepEqual(checkPrices('alinhamento sai por 140', { services: oficina }).offending, [140]);
  assert.deepEqual(checkPrices('Faço por R$ 99,90 pra voce', { services: oficina }).offending, [99.9]);
  assert.deepEqual(extractPrices('Endereco: Rua Domingos de Morais, 1450', { services: oficina, ignoreStrings: ['Rua Domingos de Morais, 1450'] }), []);
});

test('odonto: prices are stripped unless the customer asked about price', async () => {
  const k = testKani(new ScriptedLLM(reply('Claro! A limpeza custa R$180. Quer agendar uma avaliacao inicial?')));
  const { turn } = await say(k, ODONTO, 'oi, queria marcar uma limpeza');
  assert.doesNotMatch(turn.reply?.text ?? '', /180/);
  assert.equal(turn.guardTriggered, false);
  const k2 = testKani(new ScriptedLLM(reply('A limpeza custa R$180. Quer agendar?')));
  const { turn: t2 } = await say(k2, ODONTO, 'quanto custa a limpeza?');
  assert.match(t2.reply?.text ?? '', /180/);
});
