// Deterministic conversation policies that run around the LLM.
// These are safety nets: the model is instructed to follow the same rules, but code enforces them.

import { norm } from '../util/text.ts';

export function isHumanRequest(text: string): boolean {
  const t = norm(text);
  return (
    /\b(falar|conversar|fala|quero falar|me passa|me transfere|transfere|chama|chamar)\b.{0,25}\b(humano|atendente|pessoa|gente de verdade|dono|dona|gerente|responsavel|alguem da equipe|alguem de verdade|funcionario|mecanico|dentista|veterinari|doutora|doutor)/.test(
      t,
    ) ||
    /\b(atendente humano|atendimento humano|quero um atendente|quero uma atendente|nao quero falar com robo|nao quero robo|voce e um robo\?? me passa)/.test(t)
  );
}

export function isLgpdErase(text: string): boolean {
  return /\b(esquecer|esqueca|esqueçam|apagar|apague|apaguem|excluir|exclua|deletar|delete|remover|remova)\b.{0,15}\b(meus dados|minhas informacoes|meu cadastro|meus registros)/.test(
    norm(text),
  );
}

export function isOptOut(text: string): boolean {
  const t = norm(text).replace(/[.!]+$/, '');
  return /^(sair|parar|pare|stop|descadastrar|cancelar inscricao)$/.test(t) || /nao quero (mais )?receber (mais )?mensage/.test(t);
}

export function isOptIn(text: string): boolean {
  return /^(voltar|quero voltar a receber|reativar mensagens)$/.test(norm(text));
}

export function isSpam(text: string): boolean {
  const t = norm(text);
  const hits = [
    /ganhe dinheiro/,
    /clique aqui/,
    /renda extra/,
    /bit\.ly|tinyurl|encurtador/,
    /voce foi (selecionad|sortead)/,
    /pix premiado/,
    /trabalhe de casa/,
    /lucro garantido|investimento garantido|retorno garantido/,
    /promocao imperdivel/,
    /\bcripto\b.*\b(lucro|ganho)/,
  ].filter((r) => r.test(t)).length;
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const upperRatio = letters.length ? letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length : 0;
  return hits >= 2 || (hits >= 1 && upperRatio > 0.6 && letters.length > 12);
}

export function isAngry(text: string): boolean {
  return /\b(vergonha|absurdo|pessim|palhacada|ridicul|procon|reclame aqui|nunca mais|descaso|lixo|horrivel|indignad|revoltad|to puto|estou puto|falta de respeito|desrespeito|enganad|golpe|vou processar|advogado|estragaram|estragou|pior (atendimento|servico))/.test(
    norm(text),
  );
}

/** Sensitive / forbidden topics per pack that always hand the conversation to a human. */
const SENSITIVE: Record<string, RegExp> = {
  oficina:
    /\b(eletrico|hibrido|byd|tesla|carro a bateria|garantia do servico|servico anterior|refazer o servico|voltou com o mesmo problema|frota|cnpj|empresa com \d+ carros|acidente|batida com vitima)\b/,
  salao:
    /\b(gravida|gestante|amamentando|lactante|alergi|couro cabeludo sensivel|ferida|queimou|queimadura|caiu (meu|o) cabelo|cabelo caindo|reacao|irritou|irritacao)/,
  odonto:
    /\b(dor forte|dor fortissima|muita dor|dor insuportavel|inchad|inchaco|sangr|trauma|quebrei o dente|dente quebrado|caiu o dente|febre|antibiotic|remedio|medicamento|pus|abscesso|infeccao|meu filho de \d+ anos sozinho)/,
  pet: /\b(vomit|diarreia|comeu chocolate|chocolate|envenen|convuls|sangr|nao come|parou de comer|febre|remedio|dose|vermifug|atropel|intoxic|nao respira|desmai|engoliu|machucad|mancando|dou leite)/,
  estetica:
    /\b(gravida|gestante|lactante|amamentando|lupus|diabet|alergi|roacutan|isotretinoina|cancer|autoimune|queloide|resultado garantido|garante (o )?resultado|garantir resultado|irritou|irritacao|queimou|manchou)/,
};

export function sensitiveTopic(packId: string, text: string): string | null {
  const re = SENSITIVE[packId];
  if (!re) return null;
  const m = norm(text).match(re);
  return m ? m[0] : null;
}

const HEDGES =
  /\b(nao tenho certeza|nao sei (te )?(dizer|informar)|nao consigo (te )?(ajudar|responder|verificar)|nao tenho (essa|esta) informacao|vou confirmar|vou verificar com|preciso confirmar|nao entendi)/;

export function looksLowConfidence(reply: string): boolean {
  return reply.trim().length === 0 || HEDGES.test(norm(reply));
}

/** Customer replies to confirm/reschedule reminders: "1" confirms, "2" reschedules. */
export function reminderAnswer(text: string): '1' | '2' | null {
  const t = norm(text).replace(/[^a-z0-9 ]/g, ' ').trim();
  if (/^1\b|^(um)$|^confirm/.test(t)) return '1';
  if (/^2\b|^(dois)$|^remarc/.test(t)) return '2';
  return null;
}

/** Oficina: a quote is only approved with a clear approval phrase. */
export function quoteDecision(text: string): 'approved' | 'rejected' | null {
  const t = norm(text);
  if (/\b(nao aprovo|nao autorizo|nao pode fazer|recuso|nao quero fazer|nao vou fazer)\b/.test(t)) return 'rejected';
  if (/\b(aprovo|aprovado|pode fazer|pode seguir|autorizo|pode executar|pode realizar|pode mandar ver)\b/.test(t)) {
    return 'approved';
  }
  return null;
}

export function isAudioOrImagePlaceholder(text: string): boolean {
  return /^\[(foto|audio)/i.test(text.trim());
}
