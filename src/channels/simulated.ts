// SimulatedChannel: drives the web simulator. Inbound messages come from HTTP routes,
// typing indicators go out as server-sent events, outbound sends are recorded in memory.

import { randomUUID } from 'node:crypto';
import type { Channel, ContactRef, InboundHandler, InboundMessage, OutboundContent, SendResult } from './channel.ts';
import type { EventHub } from './hub.ts';

export interface OutboundRecord {
  to: ContactRef;
  content: OutboundContent;
  externalId: string;
  at: number;
}

export class SimulatedChannel implements Channel {
  readonly name = 'simulated';
  readonly outbox: OutboundRecord[] = [];
  readonly reads: { to: ContactRef; ids: (number | string)[] }[] = [];
  private handlers: InboundHandler[] = [];
  private readonly hub: EventHub | null;

  constructor(hub: EventHub | null = null) {
    this.hub = hub;
  }

  onMessage(handler: InboundHandler): void {
    this.handlers.push(handler);
  }

  /** Entry point used by the simulator HTTP route (and tests). Returns the handlers' results. */
  async receive(msg: InboundMessage): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const h of this.handlers) results.push(await h(msg));
    return results;
  }

  async send(to: ContactRef, content: OutboundContent): Promise<SendResult> {
    const externalId = `sim-${randomUUID()}`;
    this.outbox.push({ to, content, externalId, at: Date.now() });
    if (this.outbox.length > 500) this.outbox.splice(0, this.outbox.length - 500);
    return { externalId };
  }

  async typing(to: ContactRef, on: boolean): Promise<void> {
    if (this.hub && to.conversationId !== undefined) {
      this.hub.emit({ type: 'typing', tenantId: to.tenantId, conversationId: to.conversationId, on });
    }
  }

  async markRead(to: ContactRef, messageIds: (number | string)[]): Promise<void> {
    this.reads.push({ to, ids: messageIds });
    if (this.reads.length > 500) this.reads.splice(0, this.reads.length - 500);
  }
}
