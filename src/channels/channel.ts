// Channel abstraction: the transport between Kani and the customer.
// The engine owns persistence and system events; a channel only moves messages in and out.

import type { MsgType } from '../shared/api.ts';

export interface ContactRef {
  tenantId: string;
  phone: string;
  conversationId?: number;
}

export type OutboundContent =
  | { kind: 'text'; text: string }
  | { kind: 'media'; mediaType: 'image' | 'audio'; url: string; caption?: string };

export interface InboundMessage {
  tenantId: string;
  phone: string;
  name: string;
  type: MsgType;
  text?: string | null;
  mediaPath?: string | null; // file name inside the media dir
  durationS?: number | null;
  externalId?: string;
  /** Scenario runner: audio transcript supplied by the script (marked simulated-audio). */
  simulatedTranscript?: string;
  /** Scenario runner: deterministic image description instead of live vision. */
  imageDescription?: string;
}

export interface SendResult {
  externalId: string;
}

export type InboundHandler = (msg: InboundMessage) => Promise<unknown> | unknown;

export interface Channel {
  readonly name: string;
  send(to: ContactRef, content: OutboundContent): Promise<SendResult>;
  onMessage(handler: InboundHandler): void;
  typing(to: ContactRef, on: boolean): Promise<void>;
  markRead(to: ContactRef, messageIds: (number | string)[]): Promise<void>;
}
