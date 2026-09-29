import type {
  AppointmentDTO,
  AppointmentStatus,
  ConversationDTO,
  ConversationDetailDTO,
  HealthDTO,
  MessageDTO,
  MsgType,
  ReportLinkDTO,
  ServerEvent,
  SimSessionResponse,
  TenantDTO,
  WeeklyMetricsDTO,
} from '../../../src/shared/api.ts';

export type * from '../../../src/shared/api.ts';

export interface SimSendInput {
  tenantId: string;
  phone: string;
  name: string;
  type: MsgType;
  text?: string;
  durationS?: number;
  file?: Blob;
  fileName?: string;
}

export interface TimeTravelResult {
  now: string;
  offsetHours: number;
  fired: number;
}

/** Everything the UI needs from the backend. Implemented by the real HTTP client and by the mock. */
export interface KaniApi {
  health(): Promise<HealthDTO>;
  tenants(): Promise<TenantDTO[]>;
  simSession(tenantId: string, phone: string, name: string): Promise<SimSessionResponse>;
  simSend(input: SimSendInput): Promise<{ message: MessageDTO }>;
  simReset(tenantId: string, phone: string): Promise<{ ok: true }>;
  conversations(tenantId: string): Promise<ConversationDTO[]>;
  conversation(id: number): Promise<ConversationDetailDTO>;
  takeover(id: number): Promise<ConversationDTO>;
  resume(id: number): Promise<ConversationDTO>;
  ownerMessage(id: number, text: string): Promise<{ message: MessageDTO }>;
  resolveEscalation(id: number): Promise<{ ok: true }>;
  appointmentStatus(id: number, status: Extract<AppointmentStatus, 'done' | 'no_show' | 'cancelled' | 'confirmed'>): Promise<AppointmentDTO>;
  metrics(tenantId: string): Promise<WeeklyMetricsDTO>;
  reports(): Promise<ReportLinkDTO[]>;
  timeTravel(advanceHours: number): Promise<TimeTravelResult>;
  subscribe(listener: (e: ServerEvent) => void): () => void;
}
