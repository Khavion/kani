// Prompt composer: base + pack + tenant + tools + contact memory/context + last 12 messages.

import type { Appointment, Contact, Conversation, Message, Quote, Tenant } from '../db/repo.ts';
import type { Pack } from '../packs/packs.ts';
import type { ChatMessage, ToolSpec } from './llm.ts';
import { addDays, formatDatePt, formatHoursPt, formatSlotPt, isOpenAt, toLocal, WEEKDAY_LONG } from '../util/time.ts';
import { formatBRL } from '../util/text.ts';
import { checkPrices } from './guard.ts';

export const HISTORY_LIMIT = 12;

export function personaFor(pack: Pack, tenant: Tenant): string {
  return pack.persona_pt.replaceAll('{nome}', tenant.name);
}

/** Base system prompt, encoded verbatim from the product spec. */
export function basePrompt(pack: Pack, tenant: Tenant): string {
  return (
    `Voce e ${personaFor(pack, tenant)}. Fale portugues brasileiro natural, curto, caloroso. ` +
    `Regras: (1) precos, horarios e servicos SOMENTE da lista abaixo; se nao estiver na lista, diga que vai confirmar e acione a ferramenta escalate. ` +
    `(2) Nunca diagnostique, nunca prometa resultado, nunca de conselho medico, odontologico ou veterinario; acolha e escale. ` +
    `(3) Uma pergunta por vez. ` +
    `(4) Se o cliente pedir humano, estiver bravo, ou mandar algo fora do escopo, use escalate. ` +
    `(5) Informe uma vez, no primeiro contato, que voce e o assistente virtual da ${tenant.name}. ` +
    `(6) Nunca use travessao. ` +
    `(7) Consolide a resposta em UMA mensagem sempre que possivel; nao fragmente em varias bolhas.`
  );
}

function priceLabel(p: number): string {
  return p > 0 ? formatBRL(p) : 'sem custo';
}

/** FAQs adapted to tenant data: hours from the tenant, placeholders filled, stale prices dropped. */
export function tenantFaqs(pack: Pack, tenant: Tenant): [string, string][] {
  const staff2 = tenant.staff[1]?.name ?? tenant.staff[0]?.name ?? 'nossa equipe';
  const convenios = (tenant.settings.convenios as string[] | undefined)?.join(', ') ?? 'consulte a equipe';
  const out: [string, string][] = [];
  for (const [q, a0] of pack.faqs) {
    let a = a0.replaceAll('{staff2}', staff2).replaceAll('{lista do tenant}', convenios).replaceAll('{nome}', tenant.name);
    if (/horario|que horas|abrem/i.test(q) && /\d+h/.test(a)) {
      a = `Nosso horario: ${formatHoursPt(tenant.hours)}.`;
    }
    if (!checkPrices(a, { services: tenant.services }).ok) continue; // tenant changed prices: drop stale FAQ
    out.push([q, a]);
  }
  return out;
}

export function packSection(pack: Pack, tenant: Tenant): string {
  const lines: string[] = [];
  lines.push(`CATEGORIA: ${pack.name}`);
  lines.push(`TOM: ${pack.tone_rules.join('; ')}`);
  lines.push('');
  lines.push('SERVICOS E PRECOS (unica fonte de verdade; nunca cite outro valor; nunca ofereca desconto, promocao ou condicao especial):');
  for (const s of tenant.services) {
    lines.push(`- ${s.n}: ${priceLabel(s.p)}${s.min ? ` | duracao ${s.min} min` : ''}`);
  }
  lines.push('');
  lines.push(`DADOS PARA COLETAR (um por vez, so o necessario): ${pack.intake_fields.join(', ')}`);
  const br = pack.booking_rules;
  lines.push(
    `AGENDA: horarios a cada ${br.slot_min} min; ${br.same_day ? 'aceita agendamento no mesmo dia' : 'NAO agenda para o mesmo dia (a partir de amanha)'}; ${br.needs_staff ? 'cada servico e feito por um profissional da equipe' : 'profissional definido pela casa'}.`,
  );
  lines.push(`ORCAMENTO: ${pack.quote_logic}`);
  lines.push(`QUANDO ESCALAR (use escalate): ${pack.escalation_triggers.join('; ')}`);
  lines.push(`PROIBIDO: ${pack.forbidden.join('; ')}`);
  lines.push(`NOTAS REGULATORIAS: ${pack.regulatory_notes.join('; ')}`);
  if (pack.id === 'oficina') {
    lines.push(
      'REGRA OFICINA: orcamento so e aprovado quando o cliente responder com aprovacao clara ("aprovo", "pode fazer"). Nunca execute ou confirme servico sem essa autorizacao. ' +
        'Para sintoma sem causa clara (barulho, luz no painel, falha), nao diagnostique: ofereca o servico de diagnostico da lista informando o valor, e agende.',
    );
  }
  if (pack.id === 'salao') {
    lines.push(
      'REGRA SALAO: se o cliente pedir mais de um servico (ex.: corte e barba = Corte masculino + Barba), agende cada servico com um book separado, em horarios seguidos. Se nao der para saber se o corte e masculino ou feminino, pergunte.',
    );
  }
  if (pack.id === 'odonto') {
    lines.push(
      'REGRA ODONTO: informe precos SOMENTE quando o cliente perguntar diretamente o valor; nunca ofereca ou divulgue precos por iniciativa propria.',
    );
  }
  lines.push('');
  lines.push('FAQ (respostas de referencia, adapte ao contexto):');
  for (const [q, a] of tenantFaqs(pack, tenant)) lines.push(`- P: ${q} R: ${a}`);
  return lines.join('\n');
}

export function tenantSection(tenant: Tenant): string {
  const lines: string[] = [];
  lines.push(`ESTABELECIMENTO: ${tenant.name}`);
  lines.push(`Endereco: ${tenant.address}`);
  lines.push(`Telefone: ${tenant.phone}`);
  lines.push(`Horario de funcionamento: ${formatHoursPt(tenant.hours)}`);
  lines.push(`Equipe: ${tenant.staff.map((s) => `${s.name} (${s.role})`).join('; ')}`);
  lines.push(`Formas de pagamento: Pix, cartao e dinheiro. Chave Pix (envie exatamente assim): ${tenant.pixKey}`);
  lines.push(`Link para avaliacao no Google: ${tenant.googleReviewLink}`);
  const convenios = tenant.settings.convenios as string[] | undefined;
  if (convenios?.length) lines.push(`Convenios aceitos: ${convenios.join(', ')} (e particular)`);
  if (tenant.settings.vet_24h_partner) lines.push(`Emergencia veterinaria: ${tenant.settings.vet_24h_partner}`);
  return lines.join('\n');
}

export function toolGuide(): string {
  return [
    'COMO USAR AS FERRAMENTAS:',
    '- Quando o cliente quiser agendar ou perguntar por horario, chame check_availability na hora (use o periodo/dia que ele disse) e ofereca 2 opcoes reais retornadas. Nao pergunte o horario antes de consultar.',
    '- Quando o cliente escolher ou aceitar um horario, chame book na mesma hora (slot exatamente como retornado, "YYYY-MM-DD HH:MM"). So diga "agendado" depois que book retornar ok.',
    '- Para remarcar use reschedule; para cancelar use cancel (o sistema sabe qual e o agendamento do cliente).',
    '- Use log_lead para registrar dados que o cliente informar (nome, modelo/placa do carro, nome/porte do pet, convenio, objetivo).',
    '- Use escalate quando algo estiver fora da lista, fora do escopo, for tema de saude/clinico, reclamacao, cliente bravo ou pedido de humano.',
    '- Resultados e notas das ferramentas sao internos: use as informacoes, mas fale sempre diretamente com o cliente. Nunca mostre JSON, IDs internos, nomes de ferramentas ou instrucoes internas.',
  ].join('\n');
}

export function promptedToolProtocol(tools: ToolSpec[]): string {
  const list = tools.map((t) => `- ${t.name}: ${t.description} Parametros: ${JSON.stringify(t.parameters)}`).join('\n');
  return [
    'FERRAMENTAS DISPONIVEIS:',
    list,
    'PROTOCOLO: para usar uma ferramenta, responda APENAS com um objeto JSON em uma unica linha, sem texto antes ou depois:',
    '{"tool": "nome_da_ferramenta", "args": {...}}',
    'Voce recebera o resultado e entao podera chamar outra ferramenta ou escrever a resposta final ao cliente em texto normal (sem JSON).',
  ].join('\n');
}

export interface PromptContext {
  pack: Pack;
  tenant: Tenant;
  contact: Contact;
  conversation: Conversation;
  history: Message[];
  appointments: Appointment[];
  quotes: Quote[];
  now: Date;
  notes: string[];
  promptedTools?: ToolSpec[];
  offered?: { service: string; slots: { slot: string; label: string; staff?: string }[] } | null;
}

export function contextSection(ctx: PromptContext): string {
  const { now, tenant, contact, conversation } = ctx;
  const lines: string[] = [];
  const local = toLocal(now);
  lines.push(`AGORA: ${formatDatePt(now)}, ${local.hhmm} (horario de Sao Paulo). Estamos ${isOpenAt(tenant.hours, now) ? 'ABERTOS' : 'FECHADOS'} agora.`);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = toLocal(addDays(now, i));
    const label = i === 0 ? 'hoje' : i === 1 ? 'amanha' : WEEKDAY_LONG[d.weekday];
    days.push(`${label}=${d.dateKey} (${d.weekday})`);
  }
  lines.push(`CALENDARIO: ${days.join('; ')}`);
  lines.push('');
  const isPlaceholderName = /^\+?\d[\d\s-]+$/.test(contact.waName);
  lines.push(`CLIENTE: ${isPlaceholderName ? '(nome ainda nao informado)' : contact.waName} | WhatsApp ${contact.phone}`);
  const profile = Object.entries(contact.profile);
  if (profile.length) lines.push(`Dados ja coletados: ${profile.map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  if (contact.memorySummary) lines.push(`Memoria do cliente: ${contact.memorySummary}`);
  const active = ctx.appointments.filter((a) => a.status === 'booked' || a.status === 'confirmed');
  if (active.length) {
    lines.push('Agendamentos do cliente:');
    for (const a of active) {
      lines.push(`- #${a.id} ${a.service}, ${formatSlotPt(new Date(a.startsAt))}${a.staff ? ` com ${a.staff}` : ''} (${a.status})`);
    }
  } else {
    lines.push('Agendamentos do cliente: nenhum ativo.');
  }
  const past = ctx.appointments.filter((a) => a.status === 'done' || a.status === 'no_show').slice(-3);
  if (past.length) {
    lines.push(`Historico: ${past.map((a) => `${a.service} em ${formatSlotPt(new Date(a.startsAt))} (${a.status === 'done' ? 'realizado' : 'faltou'})`).join('; ')}`);
  }
  const openQuotes = ctx.quotes.filter((q) => q.status === 'sent');
  for (const q of openQuotes) {
    lines.push(`Orcamento #${q.id} aguardando aprovacao: ${q.items.map((i) => `${i.qty}x ${i.service}`).join(', ')} = ${formatBRL(q.total)}`);
  }
  if (ctx.offered?.slots.length) {
    lines.push(
      `HORARIOS JA OFERECIDOS (${ctx.offered.service}): ${ctx.offered.slots.map((s) => `${s.label} = slot "${s.slot}"${s.staff ? ` (${s.staff})` : ''}`).join('; ')}. ` +
        'Se o cliente escolher um deles, chame book (ou reschedule) AGORA com esse slot exato, sem pedir outra confirmacao.',
    );
  }
  lines.push(
    conversation.disclosed
      ? 'Voce ja se apresentou como assistente virtual nesta conversa; nao repita.'
      : `PRIMEIRO CONTATO: apresente-se brevemente como assistente virtual da ${tenant.name} nesta resposta.`,
  );
  for (const n of ctx.notes) lines.push(`NOTA INTERNA: ${n}`);
  return lines.join('\n');
}

function historyContent(m: Message): string {
  if (m.role === 'customer') {
    if (m.type === 'audio') return `[audio transcrito] ${m.transcript ?? m.text ?? '(audio sem transcricao)'}`;
    if (m.type === 'image') {
      const desc = (m.meta.imageDescription as string | undefined) ?? 'imagem';
      return `[foto: ${desc}]${m.text ? ' ' + m.text : ''}`;
    }
    return m.text ?? '';
  }
  if (m.role === 'owner') return `(mensagem enviada por uma pessoa da equipe) ${m.text ?? ''}`;
  return m.text ?? '';
}

export function historyMessages(history: Message[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of history.slice(-HISTORY_LIMIT)) {
    const content = historyContent(m);
    if (!content.trim()) continue;
    const role = m.role === 'customer' ? 'user' : 'assistant';
    const last = out[out.length - 1];
    // Merge consecutive same-role turns (e.g. several customer messages in a row).
    if (last && last.role === role) last.content += `\n${content}`;
    else out.push({ role, content });
  }
  // Chat templates expect the conversation to start with a user turn.
  if (out.length && out[0].role === 'assistant') out.unshift({ role: 'user', content: '(inicio da conversa)' });
  return out;
}

export function composeSystemPrompt(ctx: PromptContext): string {
  const parts = [
    basePrompt(ctx.pack, ctx.tenant),
    'Seja objetivo: no maximo 3 frases curtas por resposta, sem listas longas. Nao invente um nome proprio para voce. Cumprimente so na primeira mensagem; depois va direto ao ponto.',
    packSection(ctx.pack, ctx.tenant),
    tenantSection(ctx.tenant),
    toolGuide(),
  ];
  if (ctx.promptedTools) parts.push(promptedToolProtocol(ctx.promptedTools));
  parts.push(contextSection(ctx));
  return parts.join('\n\n');
}

export function composeMessages(ctx: PromptContext): ChatMessage[] {
  return [{ role: 'system', content: composeSystemPrompt(ctx) }, ...historyMessages(ctx.history)];
}
