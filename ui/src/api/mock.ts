// In-memory fake backend used when the page URL has ?mock=1.
// Mirrors the real API contract closely enough to demo every screen offline.
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
  TenantDTO,
  WeeklyMetricsDTO,
  HoursMap,
} from '../../../src/shared/api.ts';

interface ConvRec {
  conv: ConversationDTO;
  messages: MessageDTO[];
  appointments: AppointmentDTO[];
  quotes: QuoteDTO[];
  demo: boolean;
}

const HOURS_SHOP: HoursMap = {
  seg: ['08:00', '18:00'],
  ter: ['08:00', '18:00'],
  qua: ['08:00', '18:00'],
  qui: ['08:00', '18:00'],
  sex: ['08:00', '18:00'],
  sab: ['08:00', '13:00'],
  dom: null,
};
const HOURS_SALON: HoursMap = {
  seg: null,
  ter: ['09:00', '20:00'],
  qua: ['09:00', '20:00'],
  qui: ['09:00', '20:00'],
  sex: ['09:00', '20:00'],
  sab: ['09:00', '18:00'],
  dom: null,
};

const TENANTS: TenantDTO[] = [
  {
    id: 'auto-center-vila-mariana',
    name: 'Auto Center Vila Mariana',
    packId: 'oficina',
    packName: 'Oficina mecânica',
    phone: '+55 11 3456-7890',
    address: 'Rua Domingos de Morais, 1200, Vila Mariana, São Paulo',
    hours: HOURS_SHOP,
    staff: [
      { name: 'Carlos', role: 'Mecânico chefe' },
      { name: 'Diego', role: 'Eletricista automotivo' },
    ],
    services: [
      { n: 'Troca de óleo sintético', p: 189, min: 40 },
      { n: 'Alinhamento e balanceamento', p: 120, min: 60 },
      { n: 'Revisão completa', p: 450, min: 180 },
      { n: 'Pastilha de freio (par)', p: 280, min: 90 },
      { n: 'Diagnóstico eletrônico', p: 0, min: 30 },
    ],
    pixKey: 'autocentervm@pix.com.br',
    googleReviewLink: 'https://g.page/r/auto-center-vila-mariana/review',
    avatarColor: '#3b6fb6',
    emoji: '🔧',
  },
  {
    id: 'studio-bela-pinheiros',
    name: 'Studio Bela Pinheiros',
    packId: 'salao',
    packName: 'Salão de beleza',
    phone: '+55 11 3222-1100',
    address: 'Rua dos Pinheiros, 870, Pinheiros, São Paulo',
    hours: HOURS_SALON,
    staff: [
      { name: 'Bruna', role: 'Cabeleireira' },
      { name: 'Camila', role: 'Colorista' },
    ],
    services: [
      { n: 'Corte feminino', p: 95, min: 60 },
      { n: 'Corte + escova', p: 150, min: 90 },
      { n: 'Coloração', p: 260, min: 150 },
      { n: 'Manicure', p: 45, min: 45 },
    ],
    pixKey: '12.345.678/0001-90',
    googleReviewLink: 'https://g.page/r/studio-bela-pinheiros/review',
    avatarColor: '#c2528b',
    emoji: '💇',
  },
  {
    id: 'clinica-sorriso-moema',
    name: 'Clinica Sorriso Moema',
    packId: 'odonto',
    packName: 'Clínica odontológica',
    phone: '+55 11 5051-3030',
    address: 'Av. Ibirapuera, 2100, Moema, São Paulo',
    hours: HOURS_SHOP,
    staff: [
      { name: 'Dra. Paula', role: 'Clínica geral' },
      { name: 'Dr. Renato', role: 'Ortodontista' },
    ],
    services: [
      { n: 'Limpeza (profilaxia)', p: 180, min: 40 },
      { n: 'Clareamento', p: 890, min: 60 },
      { n: 'Avaliação', p: 0, min: 30 },
      { n: 'Restauração', p: 250, min: 50 },
    ],
    pixKey: 'financeiro@sorrisomoema.com.br',
    googleReviewLink: 'https://g.page/r/clinica-sorriso-moema/review',
    avatarColor: '#1f9d8f',
    emoji: '🦷',
  },
  {
    id: 'pet-care-perdizes',
    name: 'Pet Care Perdizes',
    packId: 'pet',
    packName: 'Pet shop',
    phone: '+55 11 3862-4455',
    address: 'Rua Monte Alegre, 510, Perdizes, São Paulo',
    hours: HOURS_SHOP,
    staff: [
      { name: 'Lucas', role: 'Banhista e tosador' },
      { name: 'Dra. Marina', role: 'Veterinária' },
    ],
    services: [
      { n: 'Banho (porte pequeno)', p: 70, min: 60 },
      { n: 'Banho e tosa', p: 120, min: 90 },
      { n: 'Consulta veterinária', p: 180, min: 30 },
      { n: 'Leva e traz', p: 0, min: 0 },
    ],
    pixKey: '+5511938624455',
    googleReviewLink: 'https://g.page/r/pet-care-perdizes/review',
    avatarColor: '#d9822b',
    emoji: '🐶',
  },
  {
    id: 'essenza-estetica-itaim',
    name: 'Essenza Estetica Itaim',
    packId: 'estetica',
    packName: 'Clínica de estética',
    phone: '+55 11 3078-9900',
    address: 'Rua João Cachoeira, 300, Itaim Bibi, São Paulo',
    hours: HOURS_SALON,
    staff: [
      { name: 'Juliana', role: 'Esteticista' },
      { name: 'Patrícia', role: 'Fisioterapeuta dermatofuncional' },
    ],
    services: [
      { n: 'Drenagem linfática', p: 160, min: 60 },
      { n: 'Limpeza de pele', p: 220, min: 90 },
      { n: 'Massagem relaxante', p: 180, min: 60 },
    ],
    pixKey: 'contato@essenzaitaim.com.br',
    googleReviewLink: 'https://g.page/r/essenza-estetica-itaim/review',
    avatarColor: '#8a63d2',
    emoji: '✨',
  },
];

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
        add(rec, 'customer', 'Oi, bom dia! Vocês fazem troca de óleo?', at(1, 9, 12));
        add(rec, 'assistant', 'Bom dia! Fazemos sim 😊\nA troca de óleo sintético sai por *R$ 189,00* com filtro incluso. Quer agendar?', at(1, 9, 12), {
          meta: { tools: ['search_services'] },
        });
        add(rec, 'customer', null, ago(38), {
          type: 'audio',
          mediaUrl: wavUrl(7),
          transcript: 'Queria saber se amanhã de manhã tem horário pra revisão do meu Onix, ele tá fazendo um barulho no freio.',
          meta: { durationS: 7, simulatedAudio: true },
        });
        add(rec, 'assistant', 'Tenho horário amanhã às 9h ou às 10h30 com o Carlos. Qual prefere?', ago(37), {
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
          'Pela foto parece desgaste na pastilha de freio. Posso incluir uma avaliação gratuita na revisão. Fica às 9h então?',
          ago(34),
          { meta: { tools: ['describe_image'] } },
        );
        add(rec, 'customer', 'Pode ser às 9h!', ago(33));
        add(
          rec,
          'assistant',
          'Agendado! ✅\n*Revisão completa* (Onix)\nAmanhã, 09:00 com o Carlos\nRua Domingos de Morais, 1200\n\nSe precisar remarcar é só avisar por aqui.',
          ago(33),
          { meta: { tools: ['check_availability', 'book'] } },
        );
        rec.appointments.push({
          id: nextId++,
          tenantId: t.id,
          contactId: c.id,
          service: 'Revisão completa',
          staff: 'Carlos',
          startsAt: inDays(1, 9),
          status: 'booked',
          price: 450,
        });
        rec.quotes.push({
          id: nextId++,
          tenantId: t.id,
          contactId: c.id,
          items: [
            { service: 'Revisão completa', qty: 1, price: 450 },
            { service: 'Pastilha de freio (par)', qty: 1, price: 280 },
          ],
          total: 730,
          status: 'sent',
          approvalMessageId: null,
          createdAt: ago(33),
        });
        c.memorySummary = 'Drives a 2019 Chevrolet Onix. Reported brake noise, sent a photo of the front left wheel. Prefers morning slots.';
        c.profile = { carro: 'Chevrolet Onix 2019', bairro: 'Vila Mariana', preferencia: 'Manhã' };
        break;
      }
      case 'salao': {
        add(rec, 'customer', 'Oi! Tem horário para corte e escova sábado?', at(2, 18, 40));
        add(
          rec,
          'assistant',
          'Oi! Sábado tenho às 10h com a Bruna ou às 14h com a Camila. Corte + escova fica R$ 150,00 ✂️',
          at(2, 18, 41),
          { meta: { tools: ['check_availability'] } },
        );
        add(rec, 'customer', '10h com a Bruna', at(2, 18, 43));
        add(rec, 'assistant', 'Prontinho, agendado! Sábado às 10h com a Bruna 💖', at(2, 18, 43), { meta: { tools: ['book'] } });
        add(
          rec,
          'assistant',
          `Oi! Obrigada pela visita ao Studio Bela 💖 Se puder, deixe sua avaliação, ajuda muito a gente:\n${t.googleReviewLink}`,
          at(1, 17, 5),
          { meta: { kind: 'review_request' } },
        );
        break;
      }
      case 'odonto': {
        add(rec, 'customer', 'Boa tarde, quanto custa uma limpeza?', at(3, 15, 2));
        add(
          rec,
          'assistant',
          'Boa tarde! A limpeza (profilaxia) custa R$ 180,00 e dura cerca de 40 minutos. Quer agendar com a Dra. Paula?',
          at(3, 15, 2),
          { meta: { tools: ['search_services'] } },
        );
        add(rec, 'customer', 'Quero sim, pode ser às 14h?', at(3, 15, 6));
        add(rec, 'assistant', 'Agendado ✅ Limpeza às 14h com a Dra. Paula.', at(3, 15, 6), { meta: { tools: ['check_availability', 'book'] } });
        add(
          rec,
          'assistant',
          'Lembrete 🦷 Sua limpeza é amanhã às 14h com a Dra. Paula.\nResponda *1* para confirmar ou *2* para remarcar.',
          ago(95),
          { meta: { kind: 'reminder' } },
        );
        add(rec, 'customer', '1', ago(80));
        add(rec, 'assistant', 'Confirmado! Até amanhã 😊', ago(80), { meta: { tools: ['confirm_appointment'] } });
        rec.appointments.push({
          id: nextId++,
          tenantId: t.id,
          contactId: c.id,
          service: 'Limpeza (profilaxia)',
          staff: 'Dra. Paula',
          startsAt: inDays(1, 14),
          status: 'confirmed',
          price: 180,
        });
        break;
      }
      case 'pet': {
        add(rec, 'customer', 'Vocês buscam o cachorro em casa?', at(6, 11, 20));
        add(rec, 'assistant', 'Buscamos sim! O leva e traz em Perdizes é gratuito para banho e tosa 🐶', at(6, 11, 21));
        break;
      }
      case 'estetica': {
        add(rec, 'customer', 'Quero saber o valor do pacote de 10 sessões de drenagem', ago(160));
        add(
          rec,
          'assistant',
          'Para pacotes com desconto quem passa o valor é a nossa equipe. Já pedi para uma especialista te responder por aqui, tudo bem?',
          ago(159),
          { meta: { guard: true, kind: 'handoff' } },
        );
        escalate(rec, 'Price not in catalog', ago(159));
        rec.conv.status = 'human';
        add(rec, 'owner', 'Oi! Aqui é a Juliana da Essenza 🌿 O pacote de 10 sessões sai por R$ 1.200,00 à vista ou 3x sem juros.', ago(140));
        break;
      }
    }
  }

  function seedOthers(): void {
    const auto = TENANTS[0]!;
    const roberto = newRec(auto.id, newContact('Roberto Lima', '+55 11 98765-4321', { profile: { carro: 'VW Gol 2016' } }), false);
    add(roberto, 'customer', 'O barulho voltou depois da revisão de semana passada. Estou bem chateado.', ago(26));
    add(roberto, 'assistant', 'Sinto muito pelo transtorno, Roberto. Já chamei o responsável da oficina para falar com você.', ago(25), {
      meta: { kind: 'handoff' },
    });
    escalate(roberto, 'Complaint about previous service', ago(25));
    roberto.conv.status = 'human';

    const fer = newRec(auto.id, newContact('Fernanda Alves', '+55 11 97654-1122'), false);
    add(fer, 'customer', 'Quanto fica o alinhamento e balanceamento?', ago(70));
    add(fer, 'assistant', 'O alinhamento com balanceamento sai por R$ 120,00. Tenho horário hoje às 16h, quer reservar?', ago(69), {
      meta: { tools: ['search_services', 'check_availability'] },
    });

    const marcos = newRec(auto.id, newContact('Marcos Tanaka', '+55 11 99111-2233'), false);
    add(marcos, 'assistant', `Oi Marcos! Obrigado por escolher o Auto Center 🔧 Pode avaliar nosso serviço? ${auto.googleReviewLink}`, at(1, 16, 30), {
      meta: { kind: 'review_request' },
    });
    add(marcos, 'customer', 'Avaliado! Serviço excelente 👏', at(1, 17, 2));
    marcos.conv.status = 'closed';

    const generic: [number, string, string, string][] = [
      [1, 'Juliana Rocha', 'Vocês fazem mechas?', 'Fazemos sim! Mechas começam em R$ 320,00. Quer agendar uma avaliação com a Camila?'],
      [2, 'Pedro Henrique', 'Aceitam convênio?', 'No momento atendemos apenas particular, mas parcelamos em até 6x no cartão 😊'],
      [3, 'Ana Beatriz', 'Qual o horário de sábado?', 'Aos sábados funcionamos das 08:00 às 13:00. Quer marcar um banho para a Mel?'],
      [4, 'Carla Mendes', 'Tem horário para limpeza de pele amanhã?', 'Tenho amanhã às 15h com a Juliana. Posso reservar?'],
    ];
    generic.forEach(([ti, name, q, a], i) => {
      const t = TENANTS[ti]!;
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
    if (input.type === 'audio') {
      return {
        text: 'Recebi seu áudio 👍 Tenho horários amanhã às 9h, 11h e 15h. Qual fica melhor para você?',
        meta: { tools: ['check_availability'] },
      };
    }
    if (input.type === 'image') {
      return { text: 'Recebi a foto, obrigado! Já vou encaminhar para a equipe avaliar e te retorno por aqui.', meta: { tools: ['describe_image'] } };
    }
    const q = (input.text ?? '').toLowerCase();
    if (/(pre[cç]o|quanto|valor)/.test(q)) {
      const lines = t.services.slice(0, 3).map((s) => `• ${s.n}: ${s.p ? `R$ ${s.p.toFixed(2).replace('.', ',')}` : 'sob avaliação'}`);
      return { text: `Claro! Alguns valores:\n${lines.join('\n')}\n\nQuer agendar algum desses?`, meta: { tools: ['search_services'] } };
    }
    if (/(endere|onde|local)/.test(q)) {
      return { text: `Estamos na ${t.address} 📍`, meta: {} };
    }
    const options = [
      { text: 'Tenho horários amanhã às 9h, 11h e 15h. Qual fica melhor para você?', meta: { tools: ['check_availability'] } },
      { text: 'Perfeito! Posso te ajudar com mais alguma coisa? 😊', meta: {} },
      { text: `Nosso atendimento é de segunda a sábado. Se quiser, já deixo seu horário reservado.`, meta: {} },
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
      const pet = TENANTS[3]!;
      const rec = recs.find((r) => r.demo && r.conv.tenantId === pet.id);
      if (!rec) return;
      const m = add(rec, 'assistant', 'Oi! 🐾 Já faz 30 dias do último banho. Que tal agendar para esta semana? Tenho quinta às 10h com o Lucas.', new Date(now()).toISOString(), {
        meta: { kind: 'reactivation' },
      });
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
