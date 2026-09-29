// Shared API contract between the Kani server and the web UI.
// Type-only module: safe to import from both Node and the browser bundle.

export type Role = 'customer' | 'assistant' | 'owner';
export type MsgType = 'text' | 'audio' | 'image';
export type MsgStatus = 'sent' | 'delivered' | 'read';
export type ConvStatus = 'bot' | 'human' | 'closed';
export type AppointmentStatus = 'booked' | 'confirmed' | 'cancelled' | 'no_show' | 'done';
export type QuoteStatus = 'sent' | 'approved' | 'rejected';

export interface ServiceDTO {
  n: string; // service name (pt-BR)
  p: number; // price in BRL (0 = free / on evaluation)
  min: number; // duration in minutes
}

export interface StaffDTO {
  name: string;
  role: string;
  services?: string[]; // optional subset of service names this person performs
}

// weekday key -> [open "HH:MM", close "HH:MM"] or null when closed
export type HoursMap = Record<'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab' | 'dom', [string, string] | null>;

export interface TenantDTO {
  id: string;
  name: string;
  packId: string;
  packName: string;
  phone: string;
  address: string;
  hours: HoursMap;
  staff: StaffDTO[];
  services: ServiceDTO[];
  pixKey: string;
  googleReviewLink: string;
  avatarColor: string; // hex, used for the chat avatar
  emoji: string; // single emoji shown in the avatar
}

export interface MessageMeta {
  simulatedAudio?: boolean; // audio came from a scripted transcript
  imageDescription?: string; // vision output for image messages
  guard?: boolean; // reply was replaced by the price guard
  tools?: string[]; // tool names called while producing this reply
  kind?: string; // e.g. 'reminder', 'reactivation', 'review_request', 'handoff'
  durationS?: number; // audio duration in seconds
  error?: string;
}

export interface MessageDTO {
  id: number;
  conversationId: number;
  role: Role;
  type: MsgType;
  text: string | null; // for audio: null until transcribed; for image: caption
  transcript: string | null; // audio transcript (owner view shows it)
  mediaUrl: string | null; // e.g. "/media/abc.webm"
  latencyMs: number | null; // assistant replies: time from customer msg to reply
  status: MsgStatus; // ticks for customer messages (grey -> blue when 'read')
  createdAt: string; // ISO 8601 UTC
  meta: MessageMeta;
}

export interface ContactDTO {
  id: number;
  waName: string;
  phone: string;
  memorySummary: string | null;
  optOut: boolean;
  profile: Record<string, string>;
}

export interface EscalationDTO {
  id: number;
  conversationId: number;
  reason: string;
  createdAt: string;
  resolved: boolean;
}

export interface ConversationDTO {
  id: number;
  tenantId: string;
  contact: ContactDTO;
  status: ConvStatus;
  lastMsgAt: string | null;
  lastMessage: MessageDTO | null;
  openEscalations: EscalationDTO[];
}

export interface AppointmentDTO {
  id: number;
  tenantId: string;
  contactId: number;
  service: string;
  staff: string | null;
  startsAt: string; // ISO UTC
  status: AppointmentStatus;
  price: number | null;
}

export interface QuoteDTO {
  id: number;
  tenantId: string;
  contactId: number;
  items: { service: string; qty: number; price: number }[];
  total: number;
  status: QuoteStatus;
  approvalMessageId: number | null;
  createdAt: string;
}

export interface ConversationDetailDTO {
  conversation: ConversationDTO;
  messages: MessageDTO[];
  appointments: AppointmentDTO[];
  quotes: QuoteDTO[];
}

export interface SimSessionResponse {
  conversation: ConversationDTO;
  messages: MessageDTO[];
}

export interface HealthDTO {
  ok: boolean;
  ollama: { ok: boolean; url: string; models: string[] };
  model: string;
  altModel: string;
  visionModel: string;
  whisperx: { ok: boolean; bin: string | null };
  now: string; // server clock (includes dev time-travel offset)
  offsetHours: number;
}

export interface WeeklyMetricsDTO {
  tenantId: string | 'all';
  weekStart: string;
  weekEnd: string;
  conversationsHandled: number;
  answeredUnder1MinPct: number; // 0-100
  afterHoursLeads: number;
  bookingsCreated: number;
  remindersSent: number;
  reminderConfirmationRate: number; // 0-100
  noShowsAvoided: number;
  quotesSent: number;
  quotesSentValue: number;
  quotesApproved: number;
  quotesApprovedValue: number;
  reactivatedCustomers: number;
  escalations: {
    total: number;
    byReason: { reason: string; count: number }[];
    recent: { id: number; tenantName: string; reason: string; createdAt: string; resolved: boolean }[];
  };
  topQuestions: { question: string; count: number }[];
  attributedRevenue: number;
  perTenant: {
    tenantId: string;
    tenantName: string;
    conversationsHandled: number;
    bookingsCreated: number;
    escalations: number;
    attributedRevenue: number;
  }[];
}

export interface ReportLinkDTO {
  file: string;
  url: string; // e.g. "/reports/scenarios-20260929T0100-qwen3_8b.html"
  kind: 'scenarios' | 'compare' | 'index';
  model: string | null;
  createdAt: string;
  summary?: { avgScore: number; passed: number; total: number } | null;
}

// Server-sent events on GET /api/events (one JSON object per `data:` line)
export type ServerEvent =
  | { type: 'message.created'; tenantId: string; conversationId: number; message: MessageDTO }
  | { type: 'message.updated'; tenantId: string; conversationId: number; message: MessageDTO }
  | { type: 'typing'; tenantId: string; conversationId: number; on: boolean }
  | { type: 'conversation.updated'; tenantId: string; conversation: ConversationDTO }
  | { type: 'escalation.created'; tenantId: string; conversationId: number; escalation: EscalationDTO }
  | { type: 'clock'; now: string; offsetHours: number };
