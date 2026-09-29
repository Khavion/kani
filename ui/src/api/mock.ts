// In-memory fake backend used when the page URL has ?mock=1.
// Mirrors the real API contract closely enough to demo every screen offline.
// Tenant data comes straight from seed/tenants.json and packs/*.json: the mock never invents
// prices, staff, hours, addresses or Pix keys. Canned messages read prices from the pack list.
import type { KaniApi, SimSendInput } from './types.ts';
import type {
  AppointmentDTO,
  ContactDTO,
  ConversationDTO,
  EscalationDTO,
  MessageDTO,
  MessageMeta,
  QuoteDTO,
  ReportLinkDTO,
  Role,
  ServerEvent,
  ServiceDTO,
  StaffDTO,
  TenantDTO,
  WeeklyMetricsDTO,
  HoursMap,
} from '../../../src/shared/api.ts';
import seedJson from '../../../seed/tenants.json';
import oficinaPack from '../../../packs/oficina.json';
import salaoPack from '../../../packs/salao.json';
import odontoPack from '../../../packs/odonto.json';
import petPack from '../../../packs/pet.json';
import esteticaPack from '../../../packs/estetica.json';

interface ConvRec {
  conv: ConversationDTO;
  messages: MessageDTO[];
  appointments: AppointmentDTO[];
  quotes: QuoteDTO[];
  demo: boolean;
}

interface SeedTenant {
  id: string;
  name: string;
  pack_id: string;
  phone: string;
  address: string;
  hours: HoursMap;
  staff: StaffDTO[];
  pix_key: string;
  google_review_link: string;
  settings: { avatar_color?: string; emoji?: string; convenios?: string[]; [k: string]: unknown };
}
interface PackJson {
  id: string;
  name: string;
  services: ServiceDTO[];
}

const SEED = (seedJson as unknown as { tenants: SeedTenant[] }).tenants;
const PACKS: Record<string, PackJson> = Object.fromEntries(
  ([oficinaPack, salaoPack, odontoPack, petPack, esteticaPack] as unknown as PackJson[]).map((p) => [p.id, p]),
);

function packOf(id: string): PackJson {
  const p = PACKS[id];
  if (!p) throw new Error(`unknown pack ${id}`);
  return p;
}

const TENANTS: TenantDTO[] = SEED.map((s) => {
  const pack = packOf(s.pack_id);
  return {
    id: s.id,
    name: s.name,
    packId: s.pack_id,
    packName: pack.name,
    phone: s.phone,
    address: s.address,
    hours: s.hours,
    staff: s.staff,
    services: pack.services,
    pixKey: s.pix_key,
    googleReviewLink: s.google_review_link,
    avatarColor: s.settings.avatar_color ?? '#00a884',
    emoji: s.settings.emoji ?? '💬',
  };
});

function tenantByPack(packId: string): TenantDTO {
  const t = TENANTS.find((x) => x.packId === packId);
  if (!t) throw new Error(`no seed tenant for pack ${packId}`);
  return t;
}

/** Look up a service by its exact pack name; throws so a renamed pack service fails loudly in dev. */
function svc(t: TenantDTO, name: string): ServiceDTO {
  const s = t.services.find((x) => x.n === name);
  if (!s) throw new Error(`service "${name}" not in ${t.id} pack`);
  return s;
}

/** Formats BRL like "R$ 180,00" or "R$ 1.200,00". */
function brl(p: number): string {
  const [int, cents] = p.toFixed(2).split('.');
  return `R$ ${int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`;
}

/** Price of a pack service, formatted. */
function price(t: TenantDTO, name: string): string {
  return brl(svc(t, name).p);
}

/** Staff member by index from the seed (0 = first listed). */
function staff(t: TenantDTO, i: number): string {
  const s = t.staff[i];
  if (!s) throw new Error(`${t.id} has no staff #${i}`);
  return s.name;
}

const DAY_KEYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
type DayKey = (typeof DAY_KEYS)[number];
const DAY_LABEL: Record<DayKey, string> = { dom: 'dom', seg: 'seg', ter: 'ter', qua: 'qua', qui: 'qui', sex: 'sex', sab: 'sáb' };
const DAY_PHRASE: Record<DayKey, string> = {
  dom: 'no domingo',
  seg: 'na segunda',
  ter: 'na terça',
  qua: 'na quarta',
  qui: 'na quinta',
  sex: 'na sexta',
  sab: 'no sábado',
};

/** Compact pt-BR summary of a HoursMap, e.g. "seg a sex 08:00 às 18:00, sáb 08:00 às 12:00". */
function hoursPt(h: HoursMap): string {
  const order: DayKey[] = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  const groups: { from: DayKey; to: DayKey; range: [string, string] }[] = [];
  for (const d of order) {
    const r = h[d];
    if (!r) continue;
    const last = groups[groups.length - 1];
    const prevIdx = order.indexOf(d) - 1;
    if (last && last.to === order[prevIdx] && last.range[0] === r[0] && last.range[1] === r[1]) last.to = d;
    else groups.push({ from: d, to: d, range: r });
  }
  return groups
    .map((g) => `${g.from === g.to ? DAY_LABEL[g.from] : `${DAY_LABEL[g.from]} a ${DAY_LABEL[g.to]}`} ${g.range[0]} às ${g.range[1]}`)
    .join(', ');
}

const toHour = (hhmm: string) => Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3, 5)) / 60;

function wavUrl(seconds: number): string {
  const rate = 8000;
  const n = Math.max(1, Math.round(seconds * rate));
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function wheelImage(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fa3b5"/><stop offset="1" stop-color="#46505a"/></linearGradient>
<radialGradient id="r" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8ecef"/><stop offset=".8" stop-color="#9aa4ad"/><stop offset="1" stop-color="#6c757d"/></radialGradient></defs>
<rect width="640" height="480" fill="url(#g)"/>
<rect y="330" width="640" height="150" fill="#3a3f44"/>
<path d="M0 120 Q320 60 640 120 L640 250 Q320 200 0 250Z" fill="#b8323a"/>
<circle cx="330" cy="300" r="170" fill="#1d1f22"/>
<circle cx="330" cy="300" r="112" fill="url(#r)"/>
<circle cx="330" cy="300" r="86" fill="#5b636b"/>
<g stroke="#d7dde2" stroke-width="16" stroke-linecap="round">
<line x1="330" y1="300" x2="330" y2="200"/><line x1="330" y1="300" x2="425" y2="270"/><line x1="330" y1="300" x2="389" y2="381"/><line x1="330" y1="300" x2="271" y2="381"/><line x1="330" y1="300" x2="235" y2="270"/></g>
<circle cx="330" cy="300" r="24" fill="#c9d0d6"/>
<path d="M395 225 a 95 95 0 0 1 25 40" stroke="#c0392b" stroke-width="22" fill="none"/>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function createMockApi(): KaniApi {
  const listeners = new Set<(e: ServerEvent) => void>();
  let offsetHours = 0;
  let nextId = 1000;
  let nextConvId = 1;
  let nextContactId = 1;
  let replyRotation = 0;
  const recs: ConvRec[] = [];
  const escalationIndex = new Map<number, ConvRec>();

  const now = () => Date.now() + offsetHours * 3600_000;
  const ago = (minutes: number) => new Date(now() - minutes * 60_000).toISOString();
  const spDay = (daysAgo: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(now() - daysAgo * 86_400_000),
    );
  const at = (daysAgo: number, hh: number, mm: number) =>
    new Date(`${spDay(daysAgo)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`).toISOString();
  const inDays = (days: number, hh: number) => at(-days, hh, 0);
  const weekdayKey = (daysAhead: number): DayKey => DAY_KEYS[new Date(`${spDay(-daysAhead)}T12:00:00-03:00`).getUTCDay()]!;
  /** First day (>= minDays ahead) the tenant is open from fromH until toH, per the seed hours. */
  const nextOpen = (t: TenantDTO, minDays: number, fromH: number, toH: number): { d: number; phrase: string } => {
    for (let d = minDays; d < minDays + 8; d++) {
      const key = weekdayKey(d);
      const r = t.hours[key];
      if (r && toHour(r[0]) <= fromH && toHour(r[1]) >= toH) {
        return { d, phrase: d === 0 ? 'hoje' : d === 1 ? 'amanhã' : DAY_PHRASE[key] };
      }
    }
    return { d: minDays, phrase: 'amanhã' };
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  function emit(e: ServerEvent): void {
    window.setTimeout(() => listeners.forEach((l) => l(e)), 0);
  }

  function tenantOf(id: string): TenantDTO {
    const t = TENANTS.find((x) => x.id === id);
    if (!t) throw new Error(`unknown tenant ${id}`);
    return t;
  }

  function newContact(name: string, phone: string, extra?: Partial<ContactDTO>): ContactDTO {
    return { id: nextContactId++, waName: name, phone, memorySummary: null, optOut: false, profile: {}, ...extra };
  }

  function newRec(tenantId: string, contact: ContactDTO, demo: boolean): ConvRec {
    const rec: ConvRec = {
      conv: { id: nextConvId++, tenantId, contact, status: 'bot', lastMsgAt: null, lastMessage: null, openEscalations: [] },
      messages: [],
      appointments: [],
      quotes: [],
      demo,
    };
    recs.push(rec);
    return rec;
  }

  function add(
    rec: ConvRec,
    role: Role,
    text: string | null,
    createdAt: string,
    opts: Partial<Pick<MessageDTO, 'type' | 'mediaUrl' | 'transcript' | 'status' | 'latencyMs'>> & { meta?: MessageMeta } = {},
  ): MessageDTO {
    const m: MessageDTO = {
      id: nextId++,
      conversationId: rec.conv.id,
      role,
      type: opts.type ?? 'text',
      text,
      transcript: opts.transcript ?? null,
      mediaUrl: opts.mediaUrl ?? null,
      latencyMs: opts.latencyMs ?? (role === 'assistant' ? 2400 + ((nextId * 37) % 1800) : null),
      status: opts.status ?? 'read',
      createdAt,
      meta: opts.meta ?? {},
    };
    rec.messages.push(m);
    rec.conv.lastMessage = m;
    rec.conv.lastMsgAt = m.createdAt;
    return m;
  }

  function escalate(rec: ConvRec, reason: string, createdAt: string): EscalationDTO {
    const e: EscalationDTO = { id: nextId++, conversationId: rec.conv.id, reason, createdAt, resolved: false };
    rec.conv.openEscalations.push(e);
    escalationIndex.set(e.id, rec);
    return e;
  }

  function seedDemo(rec: ConvRec, t: TenantDTO): void {
    const c = rec.conv.contact;
    switch (t.packId) {
      case 'oficina': {
        const mech = staff(t, 0);
        const slot = nextOpen(t, 1, 9, 11);
        add(rec, 'customer', 'Oi, bom dia! Vocês fazem troca de óleo?', at(1, 9, 12));
        add(rec, 'assistant', `Bom dia! Fazemos sim 😊\nA troca de óleo + filtro sai por *${price(t, 'Troca de oleo + filtro')}*. Quer agendar?`, at(1, 9, 12), {
          meta: { tools: ['search_services'] },
        });
        add(rec, 'customer', null, ago(38), {
          type: 'audio',
          mediaUrl: wavUrl(7),
          transcript: 'Queria saber quando tem horário pra revisão do meu Onix, ele tá fazendo um barulho no freio.',
          meta: { durationS: 7, simulatedAudio: true },
        });
        add(rec, 'assistant', `Tenho ${slot.phrase} às 9h ou às 10h30 com o ${mech}. Qual prefere?`, ago(37), {
          meta: { tools: ['check_availability'] },
        });
        add(rec, 'customer', 'O barulho vem daqui', ago(35), {
          type: 'image',
          mediaUrl: wheelImage(),
          meta: { imageDescription: 'Close of a car front wheel with a visibly worn brake pad area highlighted in red.' },
        });
        add(
          rec,
          'assistant',
          `Pela foto parece desgaste na pastilha de freio, mas o valor fechado só sai depois que o ${mech} olhar o carro. As pastilhas de freio dianteiras (par) saem por ${price(t, 'Pastilhas de freio (dianteira, par)')} e a revisão básica por ${price(t, 'Revisao basica')}. Fica às 9h então?`,
          ago(34),
          { meta: { tools: ['describe_image', 'search_services'] } },
        );
        add(rec, 'customer', 'Pode ser às 9h!', ago(33));
        add(
          rec,
          'assistant',
          `Agendado! ✅\n*Revisão básica* (Onix)\n${cap(slot.phrase)}, 09:00 com o ${mech}\n${t.address}\n\nSe precisar remarcar é só avisar por aqui.`,
          ago(33),
          { meta: { tools: ['check_availability', 'book', 'create_quote'] } },
        );
        const revisao = svc(t, 'Revisao basica');
        const pastilhas = svc(t, 'Pastilhas de freio (dianteira, par)');
        rec.appointments.push({
          id: nextId++,
          tenantId: t.id,
          contactId: c.id,
          service: revisao.n,
          staff: mech,
          startsAt: inDays(slot.d, 9),
          status: 'booked',
          price: revisao.p,
        });
        rec.quotes.push({
          id: nextId++,
          tenantId: t.id,
          contactId: c.id,
          items: [
            { service: revisao.n, qty: 1, price: revisao.p },
            { service: pastilhas.n, qty: 1, price: pastilhas.p },
          ],
          total: revisao.p + pastilhas.p,
          status: 'sent',
          approvalMessageId: null,
          createdAt: ago(33),
        });
        c.memorySummary = 'Drives a 2019 Chevrolet Onix. Reported brake noise, sent a photo of the front left wheel. Prefers morning slots.';
        c.profile = { carro: 'Chevrolet Onix 2019', bairro: 'Vila Mariana', preferencia: 'Manhã' };
        break;
      }
      case 'salao': {
        const rafael = staff(t, 0);
        const juliana = staff(t, 1);
        add(rec, 'customer', 'Oi! Tem horário para corte e escova sábado?', at(2, 18, 40));
        add(
          rec,
          'assistant',
          `Oi! Sábado tenho às 10h com o ${rafael} ou às 14h com a ${juliana}. O corte feminino é ${price(t, 'Corte feminino')} e a escova ${price(t, 'Escova')} ✂️`,
          at(2, 18, 41),
          { meta: { tools: ['search_services', 'check_availability'] } },
        );
        add(rec, 'customer', `10h com o ${rafael}`, at(2, 18, 43));
        add(rec, 'assistant', `Prontinho, agendado! Sábado às 10h com o ${rafael} 💖`, at(2, 18, 43), { meta: { tools: ['book'] } });
        add(
          rec,
          'assistant',
          `Oi! Obrigada pela visita ao ${t.name} 💖 Se puder, deixe sua avaliação, ajuda muito a gente:\n${t.googleReviewLink}`,
          at(1, 17, 5),
          { meta: { kind: 'review_request' } },
        );
        break;
      }
      case 'odonto': {
        const dra = staff(t, 0);
        const limpeza = svc(t, 'Limpeza (profilaxia)');
        const slot = nextOpen(t, 1, 14, 15);
        add(rec, 'customer', 'Boa tarde, quanto custa uma limpeza?', at(3, 15, 2));
        add(
          rec,
          'assistant',
          `Boa tarde! A limpeza (profilaxia) custa ${brl(limpeza.p)} e dura cerca de ${limpeza.min} minutos. Quer agendar com a ${dra}?`,
          at(3, 15, 2),
          { meta: { tools: ['search_services'] } },
        );
        add(rec, 'customer', 'Quero sim, pode ser às 14h?', at(3, 15, 6));
        add(rec, 'assistant', `Agendado ✅ Limpeza ${slot.phrase} às 14h com a ${dra}.`, at(3, 15, 6), {
          meta: { tools: ['check_availability', 'book'] },
        });
        add(
          rec,
          'assistant',
          `Lembrete 🦷 Sua limpeza é ${slot.phrase} às 14h com a ${dra}.\nResponda *1* para confirmar ou *2* para remarcar.`,
          ago(95),
          { meta: { kind: 'reminder' } },
        );
        add(rec, 'customer', '1', ago(80));
        add(rec, 'assistant', 'Confirmado! Até lá 😊', ago(80), { meta: { tools: ['confirm_appointment'] } });
        rec.appointments.push({
          id: nextId++,
          tenantId: t.id,
          contactId: c.id,
          service: limpeza.n,
          staff: dra,
          startsAt: inDays(slot.d, 14),
          status: 'confirmed',
          price: limpeza.p,
        });
        break;
      }
      case 'pet': {
        add(rec, 'customer', 'Vocês buscam o cachorro em casa?', at(6, 11, 20));
        add(
          rec,
          'assistant',
          `Ainda não temos leva e traz 🐶 Mas atendemos com hora marcada certinha. O banho sai ${price(t, 'Banho (porte pequeno)')} (pequeno), ${price(t, 'Banho (porte medio)')} (médio) ou ${price(t, 'Banho (porte grande)')} (grande). Qual o porte do seu pet?`,
          at(6, 11, 21),
          { meta: { tools: ['search_services'] } },
        );
        break;
      }
      case 'estetica': {
        const patricia = staff(t, 0);
        const carla = staff(t, 1);
        add(rec, 'customer', 'Quanto fica um pacote de 5 sessões de microagulhamento?', ago(160));
        add(
          rec,
          'assistant',
          'Esse pacote não está na nossa tabela, então quem passa o valor é a nossa equipe. Já pedi para uma especialista te responder por aqui, tudo bem?',
          ago(159),
          { meta: { guard: true, kind: 'handoff' } },
        );
        escalate(rec, 'Price not in catalog', ago(159));
        rec.conv.status = 'human';
        add(
          rec,
          'owner',
          `Oi! Aqui é a ${patricia} da Essenza 🌿 O protocolo de microagulhamento a ${carla} define na avaliação estética, que é gratuita. A sessão avulsa sai por ${price(t, 'Microagulhamento (sessao)')}, e parcelamos em até 6x no cartão.`,
          ago(140),
        );
        break;
      }
    }
  }

  function seedOthers(): void {
    const auto = tenantByPack('oficina');
    const salao = tenantByPack('salao');
    const odonto = tenantByPack('odonto');
    const pet = tenantByPack('pet');
    const estetica = tenantByPack('estetica');

    const roberto = newRec(auto.id, newContact('Roberto Lima', '+55 11 98765-4321', { profile: { carro: 'VW Gol 2016' } }), false);
    add(roberto, 'customer', 'O barulho voltou depois da revisão de semana passada. Estou bem chateado.', ago(26));
    add(roberto, 'assistant', 'Sinto muito pelo transtorno, Roberto. Já chamei o responsável da oficina para falar com você.', ago(25), {
      meta: { kind: 'handoff' },
    });
    escalate(roberto, 'Complaint about previous service', ago(25));
    roberto.conv.status = 'human';

    const fer = newRec(auto.id, newContact('Fernanda Alves', '+55 11 97654-1122'), false);
    const ferSlot = nextOpen(auto, 0, 16, 17);
    add(fer, 'customer', 'Quanto fica o alinhamento e balanceamento?', ago(70));
    add(
      fer,
      'assistant',
      `O alinhamento e balanceamento sai por ${price(auto, 'Alinhamento e balanceamento')}. Tenho horário ${ferSlot.phrase} às 16h, quer reservar?`,
      ago(69),
      { meta: { tools: ['search_services', 'check_availability'] } },
    );

    const thiago = newRec(auto.id, newContact('Thiago Tanaka', '+55 11 99111-2233'), false);
    add(thiago, 'assistant', `Oi Thiago! Obrigado por escolher o ${auto.name} 🔧 Pode avaliar nosso serviço? ${auto.googleReviewLink}`, at(1, 16, 30), {
      meta: { kind: 'review_request' },
    });
    add(thiago, 'customer', 'Avaliado! Serviço excelente 👏', at(1, 17, 2));
    thiago.conv.status = 'closed';

    const convenios = ((SEED.find((s) => s.id === odonto.id)?.settings.convenios as string[] | undefined) ?? []).join(', ');
    const sab = pet.hours.sab;
    const esteticaSlot = nextOpen(estetica, 1, 15, 17);
    const generic: [TenantDTO, string, string, string][] = [
      [
        salao,
        'Larissa Rocha',
        'Vocês fazem mechas?',
        `Fazemos sim! Luzes/mechas saem por ${price(salao, 'Luzes/mechas')}. A ${staff(salao, 1)} é nossa colorista, quer ver horários com ela?`,
      ],
      [
        odonto,
        'Pedro Henrique',
        'Aceitam convênio?',
        convenios
          ? `Atendemos particular e os convênios ${convenios}. A avaliação inicial é gratuita, quer agendar?`
          : 'Atendemos particular. A avaliação inicial é gratuita, quer agendar?',
      ],
      [
        pet,
        'Ana Beatriz',
        'Qual o horário de sábado?',
        sab ? `Aos sábados funcionamos das ${sab[0]} às ${sab[1]}. Quer marcar um banho para a Mel?` : 'Aos sábados não abrimos. Quer marcar um banho para a Mel durante a semana?',
      ],
      [
        estetica,
        'Camila Mendes',
        'Tem horário para limpeza de pele essa semana?',
        `Tenho ${esteticaSlot.phrase} às 15h com a ${staff(estetica, 0)}. A limpeza de pele profunda sai por ${price(estetica, 'Limpeza de pele profunda')}. Posso reservar?`,
      ],
    ];
    generic.forEach(([t, name, q, a], i) => {
      const r = newRec(t.id, newContact(name, `+55 11 9${8000 + i * 111}-${4000 + i * 77}`), false);
      add(r, 'customer', q, ago(200 + i * 45));
      add(r, 'assistant', a, ago(199 + i * 45), { meta: { tools: ['check_availability'] } });
    });
  }
  seedOthers();

  function findDemo(tenantId: string, phone: string): ConvRec | undefined {
    return recs.find((r) => r.demo && r.conv.tenantId === tenantId && r.conv.contact.phone === phone);
  }

  function ensureDemo(tenantId: string, phone: string, name: string): ConvRec {
    let rec = findDemo(tenantId, phone);
    if (!rec) {
      rec = newRec(tenantId, newContact(name, phone), true);
      seedDemo(rec, tenantOf(tenantId));
    } else if (name) {
      rec.conv.contact.waName = name;
    }
    return rec;
  }

  const clone = <T>(v: T): T => structuredClone(v);

  function emitMessage(rec: ConvRec, m: MessageDTO, kind: 'message.created' | 'message.updated' = 'message.created'): void {
    emit({ type: kind, tenantId: rec.conv.tenantId, conversationId: rec.conv.id, message: clone(m) });
    if (kind === 'message.created') emit({ type: 'conversation.updated', tenantId: rec.conv.tenantId, conversation: clone(rec.conv) });
  }

  function cannedReply(t: TenantDTO, input: SimSendInput): { text: string; meta: MessageMeta } {
    const slot = nextOpen(t, 1, 10, 16);
    const slotsText = `Tenho horários ${slot.phrase} às 10h, 11h e 15h. Qual fica melhor para você?`;
    if (input.type === 'audio') {
      return { text: `Recebi seu áudio 👍 ${slotsText}`, meta: { tools: ['check_availability'] } };
    }
    if (input.type === 'image') {
      return { text: 'Recebi a foto, obrigado! Já vou encaminhar para a equipe avaliar e te retorno por aqui.', meta: { tools: ['describe_image'] } };
    }
    const q = (input.text ?? '').toLowerCase();
    if (/(pre[cç]o|quanto|valor)/.test(q)) {
      const lines = t.services.slice(0, 3).map((s) => `• ${s.n}: ${s.p ? brl(s.p) : 'sob avaliação'}`);
      return { text: `Claro! Alguns valores:\n${lines.join('\n')}\n\nQuer agendar algum desses?`, meta: { tools: ['search_services'] } };
    }
    if (/(endere|onde|local)/.test(q)) {
      return { text: `Estamos na ${t.address} 📍`, meta: {} };
    }
    if (/pix/.test(q)) {
      return { text: `Nossa chave Pix é ${t.pixKey}`, meta: {} };
    }
    const options = [
      { text: slotsText, meta: { tools: ['check_availability'] } },
      { text: 'Perfeito! Posso te ajudar com mais alguma coisa? 😊', meta: {} },
      { text: `Nosso horário: ${hoursPt(t.hours)}. Se quiser, já deixo seu horário reservado.`, meta: {} },
    ];
    return options[replyRotation++ % options.length]!;
  }

  function simulateBot(rec: ConvRec, customerMsg: MessageDTO, input: SimSendInput): void {
    const t = tenantOf(rec.conv.tenantId);
    window.setTimeout(() => {
      customerMsg.status = 'delivered';
      emitMessage(rec, customerMsg, 'message.updated');
    }, 600);
    if (customerMsg.type === 'audio') {
      window.setTimeout(() => {
        customerMsg.transcript = 'Mensagem de voz gravada no modo demonstração.';
        emitMessage(rec, customerMsg, 'message.updated');
      }, 1800);
    }
    if (customerMsg.type === 'image') {
      window.setTimeout(() => {
        customerMsg.meta = { ...customerMsg.meta, imageDescription: 'A photo sent by the customer (mock vision output).' };
        emitMessage(rec, customerMsg, 'message.updated');
      }, 1800);
    }
    if (rec.conv.status !== 'bot') return;
    window.setTimeout(() => {
      customerMsg.status = 'read';
      emitMessage(rec, customerMsg, 'message.updated');
      emit({ type: 'typing', tenantId: t.id, conversationId: rec.conv.id, on: true });
    }, 1200);
    window.setTimeout(() => {
      emit({ type: 'typing', tenantId: t.id, conversationId: rec.conv.id, on: false });
      if (rec.conv.status !== 'bot') return;
      const r = cannedReply(t, input);
      const m = add(rec, 'assistant', r.text, new Date(now()).toISOString(), { meta: r.meta });
      emitMessage(rec, m);
    }, 3400);
  }

  function schedulePush(): void {
    // A proactive reminder from another business so the unread badge can be demoed.
    window.setTimeout(() => {
      const pet = tenantByPack('pet');
      const rec = recs.find((r) => r.demo && r.conv.tenantId === pet.id);
      if (!rec) return;
      const slot = nextOpen(pet, 2, 10, 12);
      const m = add(
        rec,
        'assistant',
        `Oi! 🐾 Já faz 30 dias do último banho. Que tal agendar? Tenho ${slot.phrase} às 10h com o ${staff(pet, 1)}.`,
        new Date(now()).toISOString(),
        { meta: { kind: 'reactivation' } },
      );
      emitMessage(rec, m);
    }, 6000);
  }
  let pushScheduled = false;

  const delay = <T>(v: T, ms = 120): Promise<T> => new Promise((res) => window.setTimeout(() => res(clone(v)), ms));

  function recById(id: number): ConvRec {
    const r = recs.find((x) => x.conv.id === id);
    if (!r) throw new Error(`conversation ${id} not found`);
    return r;
  }

  function metricsFor(tenantId: string): WeeklyMetricsDTO {
    const perTenant = [
      { tenantId: TENANTS[0]!.id, tenantName: TENANTS[0]!.name, conversationsHandled: 64, bookingsCreated: 21, escalations: 3, attributedRevenue: 9840 },
      { tenantId: TENANTS[1]!.id, tenantName: TENANTS[1]!.name, conversationsHandled: 88, bookingsCreated: 37, escalations: 2, attributedRevenue: 5620 },
      { tenantId: TENANTS[2]!.id, tenantName: TENANTS[2]!.name, conversationsHandled: 52, bookingsCreated: 19, escalations: 1, attributedRevenue: 7310 },
      { tenantId: TENANTS[3]!.id, tenantName: TENANTS[3]!.name, conversationsHandled: 47, bookingsCreated: 22, escalations: 0, attributedRevenue: 2640 },
      { tenantId: TENANTS[4]!.id, tenantName: TENANTS[4]!.name, conversationsHandled: 39, bookingsCreated: 14, escalations: 2, attributedRevenue: 4480 },
    ];
    const rows = tenantId === 'all' ? perTenant : perTenant.filter((r) => r.tenantId === tenantId);
    const share = tenantId === 'all' ? 1 : (rows[0]?.conversationsHandled ?? 0) / 290;
    const s = (n: number) => Math.round(n * share);
    const recent = recs
      .flatMap((r) =>
        r.conv.openEscalations.map((e) => ({
          id: e.id,
          tenantName: tenantOf(r.conv.tenantId).name,
          tenantId: r.conv.tenantId,
          reason: e.reason,
          createdAt: e.createdAt,
          resolved: e.resolved,
        })),
      )
      .concat([
        { id: 1, tenantName: TENANTS[1]!.name, tenantId: TENANTS[1]!.id, reason: 'Customer asked for a human', createdAt: ago(60 * 26), resolved: true },
        { id: 2, tenantName: TENANTS[2]!.name, tenantId: TENANTS[2]!.id, reason: 'Medical question', createdAt: ago(60 * 50), resolved: true },
      ])
      .filter((e) => tenantId === 'all' || e.tenantId === tenantId)
      .map(({ tenantId: _t, ...rest }) => rest);
    const weekEnd = new Date(now());
    const weekStart = new Date(now() - 7 * 86_400_000);
    return {
      tenantId,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      conversationsHandled: rows.reduce((a, r) => a + r.conversationsHandled, 0),
      answeredUnder1MinPct: 96.4,
      afterHoursLeads: s(57),
      bookingsCreated: rows.reduce((a, r) => a + r.bookingsCreated, 0),
      remindersSent: s(84),
      reminderConfirmationRate: 81.0,
      noShowsAvoided: s(12),
      quotesSent: s(23),
      quotesSentValue: s(18450),
      quotesApproved: s(14),
      quotesApprovedValue: s(11200),
      reactivatedCustomers: s(9),
      escalations: {
        total: rows.reduce((a, r) => a + r.escalations, 0),
        byReason: [
          { reason: 'Price not in catalog', count: s(3) || 1 },
          { reason: 'Customer asked for a human', count: s(2) },
          { reason: 'Complaint about previous service', count: s(2) },
          { reason: 'Medical question', count: s(1) },
        ].filter((r) => r.count > 0),
        recent,
      },
      topQuestions: [
        { question: 'Quanto custa?', count: s(71) },
        { question: 'Tem horário amanhã?', count: s(54) },
        { question: 'Qual o endereço?', count: s(33) },
        { question: 'Aceita cartão / PIX?', count: s(28) },
        { question: 'Funciona no sábado?', count: s(19) },
      ],
      attributedRevenue: rows.reduce((a, r) => a + r.attributedRevenue, 0),
      perTenant: rows,
    };
  }

  const reports: ReportLinkDTO[] = [
    {
      file: 'scenarios-20260928T0100-qwen3_8b.html',
      url: '/reports/scenarios-20260928T0100-qwen3_8b.html',
      kind: 'scenarios',
      model: 'qwen3:8b',
      createdAt: new Date(Date.now() - 20 * 3600_000).toISOString(),
      summary: { avgScore: 4.3, passed: 27, total: 30 },
    },
    {
      file: 'scenarios-20260927T0100-llama3.1_8b.html',
      url: '/reports/scenarios-20260927T0100-llama3.1_8b.html',
      kind: 'scenarios',
      model: 'llama3.1:8b',
      createdAt: new Date(Date.now() - 44 * 3600_000).toISOString(),
      summary: { avgScore: 3.8, passed: 23, total: 30 },
    },
    {
      file: 'compare-20260928T0130.html',
      url: '/reports/compare-20260928T0130.html',
      kind: 'compare',
      model: null,
      createdAt: new Date(Date.now() - 19 * 3600_000).toISOString(),
      summary: null,
    },
  ];

  return {
    health: () =>
      delay({
        ok: true,
        ollama: { ok: true, url: 'http://localhost:11434', models: ['qwen3:8b', 'llama3.1:8b', 'qwen2.5vl:7b'] },
        model: 'qwen3:8b',
        altModel: 'llama3.1:8b',
        visionModel: 'qwen2.5vl:7b',
        whisperx: { ok: true, bin: '/usr/local/bin/whisperx' },
        now: new Date(now()).toISOString(),
        offsetHours,
      }),
    tenants: () => delay(TENANTS),
    simSession: (tenantId, phone, name) => {
      const rec = ensureDemo(tenantId, phone, name);
      if (!pushScheduled) {
        pushScheduled = true;
        schedulePush();
      }
      return delay({ conversation: rec.conv, messages: rec.messages }, 150);
    },
    simSend: (input) => {
      const rec = ensureDemo(input.tenantId, input.phone, input.name);
      const mediaUrl = input.file ? URL.createObjectURL(input.file) : null;
      const m = add(rec, 'customer', input.type === 'audio' ? null : (input.text ?? null), new Date(now()).toISOString(), {
        type: input.type,
        mediaUrl,
        status: 'sent',
        meta: input.durationS ? { durationS: input.durationS } : {},
      });
      emit({ type: 'conversation.updated', tenantId: rec.conv.tenantId, conversation: clone(rec.conv) });
      simulateBot(rec, m, input);
      return delay({ message: m }, 350);
    },
    simReset: (tenantId, phone) => {
      const rec = findDemo(tenantId, phone);
      if (rec) recs.splice(recs.indexOf(rec), 1);
      const fresh = newRec(tenantId, newContact(rec?.conv.contact.waName ?? 'Cliente Demo', phone), true);
      void fresh;
      return delay({ ok: true as const });
    },
    conversations: (tenantId) =>
      delay(
        recs
          .filter((r) => r.conv.tenantId === tenantId && r.conv.lastMsgAt)
          .map((r) => r.conv)
          .sort((a, b) => (b.lastMsgAt ?? '').localeCompare(a.lastMsgAt ?? '')),
      ),
    conversation: (id) => {
      const r = recById(id);
      return delay({ conversation: r.conv, messages: r.messages, appointments: r.appointments, quotes: r.quotes });
    },
    takeover: (id) => {
      const r = recById(id);
      r.conv.status = 'human';
      emit({ type: 'conversation.updated', tenantId: r.conv.tenantId, conversation: clone(r.conv) });
      return delay(r.conv);
    },
    resume: (id) => {
      const r = recById(id);
      r.conv.status = 'bot';
      emit({ type: 'conversation.updated', tenantId: r.conv.tenantId, conversation: clone(r.conv) });
      return delay(r.conv);
    },
    ownerMessage: (id, text) => {
      const r = recById(id);
      const m = add(r, 'owner', text, new Date(now()).toISOString());
      emitMessage(r, m);
      return delay({ message: m });
    },
    resolveEscalation: (id) => {
      const r = escalationIndex.get(id);
      if (r) {
        r.conv.openEscalations = r.conv.openEscalations.filter((e) => e.id !== id);
        emit({ type: 'conversation.updated', tenantId: r.conv.tenantId, conversation: clone(r.conv) });
      }
      return delay({ ok: true as const });
    },
    appointmentStatus: (id, status) => {
      for (const r of recs) {
        const a = r.appointments.find((x) => x.id === id);
        if (a) {
          a.status = status;
          return delay(a);
        }
      }
      return Promise.reject(new Error('appointment not found'));
    },
    metrics: (tenantId) => delay(metricsFor(tenantId), 200),
    reports: () => delay(reports),
    timeTravel: (advanceHours) => {
      offsetHours += advanceHours;
      const n = new Date(now()).toISOString();
      emit({ type: 'clock', now: n, offsetHours });
      return delay({ now: n, offsetHours, fired: advanceHours >= 24 ? 2 : 0 });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
