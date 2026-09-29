// Deterministic customer-facing templates (pt-BR). No em-dashes anywhere.

import type { Appointment, Contact, Tenant } from '../db/repo.ts';
import type { Pack } from '../packs/packs.ts';
import { formatSlotPt } from '../util/time.ts';

export const REMINDER_CTA = 'Responda 1 para confirmar, 2 para remarcar.';

function firstName(c: Contact): string {
  const n = (c.profile.nome as string | undefined) ?? c.waName;
  if (!n || /^\+?\d[\d\s-]+$/.test(n)) return '';
  return n.trim().split(/\s+/)[0];
}

function hi(c: Contact): string {
  const n = firstName(c);
  return n ? `Oi, ${n}!` : 'Oi!';
}

export function confirmReminder(c: Contact, a: Appointment, intro: string, kind: string): string {
  const when = formatSlotPt(new Date(a.startsAt));
  const lead = kind === 'confirm_2h' ? 'Seu horário é daqui a pouco' : 'Passando pra lembrar do seu horário';
  return `${hi(c)} ${intro} ${lead}: ${a.service}, ${when}${a.staff ? ` com ${a.staff}` : ''}. ${REMINDER_CTA}`;
}

export function confirmed(a: Appointment): string {
  return `Confirmado! Te esperamos ${formatSlotPt(new Date(a.startsAt))}. Qualquer coisa, é só chamar por aqui.`;
}

export function reactivation(pack: Pack, c: Contact, intro: string): string {
  const p = c.profile;
  const modelo = p.modelo ?? p.modelo_do_carro ?? p.modelo_e_ano_do_carro ?? p.carro;
  const pet = p.nome_do_pet ?? p.pet;
  let offer = pack.reminders.reactivation_pt;
  offer = modelo ? offer.replace('{modelo}', modelo) : offer.replace('{modelo}', 'seu carro');
  offer = pet ? offer.replace('{pet}', pet) : offer.replace('{pet}', 'seu pet');
  return `${hi(c)} ${intro} Faz um tempinho desde a sua última visita. Que tal ${offer}? Posso ver um horário pra você. Se preferir não receber essas mensagens, responda SAIR.`;
}

export function noShowRecovery(c: Contact, a: Appointment, intro: string): string {
  return `${hi(c)} ${intro} Sentimos sua falta no horário de ${a.service}. Imprevistos acontecem, sem problema nenhum! Quer que eu veja um novo horário pra você?`;
}

export function reviewRequest(c: Contact, t: Tenant): string {
  return `${hi(c)} Muito obrigado pela visita hoje na ${t.name}! Se puder, deixa sua avaliação no Google, ajuda demais: ${t.googleReviewLink}`;
}

export function handoff(): string {
  return 'Claro! Já chamei alguém da equipe pra continuar o atendimento com você. Só um instantinho.';
}

export function spam(t: Tenant): string {
  return `Oi! Por aqui a gente atende só assuntos da ${t.name}. Se precisar de algo, é só chamar.`;
}

export function optOut(): string {
  return 'Tudo certo, você não vai mais receber lembretes nem mensagens de retorno. Se precisar, é só chamar por aqui.';
}

export function optIn(): string {
  return 'Pronto, você voltou a receber nossos lembretes. Como posso te ajudar?';
}

export function lgpdWiped(t: Tenant): string {
  return `Pronto! Apaguei seus dados e o histórico desta conversa na ${t.name}, conforme a LGPD. Se precisar de algo no futuro, é só chamar.`;
}
