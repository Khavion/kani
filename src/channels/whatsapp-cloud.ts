// WhatsAppCloudChannel: STUB for the Meta WhatsApp Cloud API. It implements the Channel contract
// and records every Graph API call it would make (see `calls`) instead of performing HTTP requests.
// It is the seam where the production channel plugs in.
//
// TODO(production) checklist:
// - Embedded Signup: onboard each tenant's number via Meta Embedded Signup (Facebook Login for
//   Business). Persist per tenant: waba_id, phone_number_id, a system-user access token (encrypted),
//   business verification status. Map inbound webhooks to tenants by phone_number_id.
// - Webhook verification: GET /webhooks/whatsapp answers hub.challenge when hub.mode=subscribe and
//   hub.verify_token matches (see verifyWebhook). Every POST must validate X-Hub-Signature-256
//   (HMAC-SHA256 of the raw body with the app secret) before trusting the payload.
// - Media download: inbound audio/image carry a media id. GET /{media-id} returns a short-lived URL;
//   download it with the bearer token, store under data/media, then hand the file to the engine
//   (whisperX for voice notes, vision for images). URLs expire in minutes: download immediately.
// - 24h customer service window: free-form messages are only allowed within 24h of the customer's
//   last inbound message. Outside it (reminders, reactivation) you must send an approved template.
//   isWithinServiceWindow() tracks this per contact; the scheduler must route out-of-window sends
//   through sendTemplate().
// - Template sender: sendTemplate(name, language, components) for pre-approved templates
//   (confirm_24h, confirm_2h, reactivation, review_request). Templates need Meta approval and
//   quality monitoring; keep the pt_BR copy in sync with the simulator templates.
// - Coexistence (WhatsApp Business app + Cloud API on the same number): throughput is capped at
//   20 msg/s per number, chat backups on the phone are disabled after onboarding, group chats and
//   some features stay app-only, and messages sent from the phone arrive as "smb_message_echoes"
//   webhooks that must be stored as role=owner (the owner typing on the phone = TAKE OVER).
// - Typing indicator: POST /messages {status:"read", message_id, typing_indicator:{type:"text"}}
//   shows "digitando..." for up to 25s or until the next message is sent.
// - Rate limiting and retries: respect 429/131056 (pair rate limit) with backoff; outbound queue per number.

import { randomUUID } from 'node:crypto';
import type { Channel, ContactRef, InboundHandler, InboundMessage, OutboundContent, SendResult } from './channel.ts';

export interface GraphCall {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

export interface WhatsAppCloudOptions {
  phoneNumberId: string;
  verifyToken: string;
  graphVersion?: string;
  /** Maps phone_number_id -> tenant id for inbound routing. */
  tenantByPhoneNumberId?: Record<string, string>;
}

const SERVICE_WINDOW_MS = 24 * 3_600_000;
export const COEXISTENCE_MAX_MSG_PER_SEC = 20;

export class WhatsAppCloudChannel implements Channel {
  readonly name = 'whatsapp-cloud';
  readonly calls: GraphCall[] = [];
  private handlers: InboundHandler[] = [];
  private lastInboundAt = new Map<string, number>();
  private lastInboundWamid = new Map<string, string>();
  private readonly opts: Required<Omit<WhatsAppCloudOptions, 'tenantByPhoneNumberId'>> & {
    tenantByPhoneNumberId: Record<string, string>;
  };

  constructor(opts: WhatsAppCloudOptions) {
    this.opts = { graphVersion: 'v21.0', tenantByPhoneNumberId: {}, ...opts };
  }

  private messagesPath(): string {
    return `/${this.opts.graphVersion}/${this.opts.phoneNumberId}/messages`;
  }

  onMessage(handler: InboundHandler): void {
    this.handlers.push(handler);
  }

  async send(to: ContactRef, content: OutboundContent): Promise<SendResult> {
    // TODO(production): if !isWithinServiceWindow(to.phone) the Cloud API rejects free-form text;
    // route through sendTemplate instead. The stub records the call either way.
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.phone.replace(/\D/g, ''),
    };
    if (content.kind === 'text') {
      body.type = 'text';
      body.text = { preview_url: true, body: content.text };
    } else {
      body.type = content.mediaType;
      body[content.mediaType] = { link: content.url, ...(content.caption ? { caption: content.caption } : {}) };
    }
    this.calls.push({ method: 'POST', path: this.messagesPath(), body });
    return { externalId: `wamid.stub-${randomUUID()}` };
  }

  async typing(to: ContactRef, on: boolean): Promise<void> {
    if (!on) return; // the indicator clears itself when the next message is sent
    const wamid = this.lastInboundWamid.get(to.phone);
    if (!wamid) return;
    this.calls.push({
      method: 'POST',
      path: this.messagesPath(),
      body: { messaging_product: 'whatsapp', status: 'read', message_id: wamid, typing_indicator: { type: 'text' } },
    });
  }

  async markRead(_to: ContactRef, messageIds: (number | string)[]): Promise<void> {
    for (const id of messageIds) {
      this.calls.push({
        method: 'POST',
        path: this.messagesPath(),
        body: { messaging_product: 'whatsapp', status: 'read', message_id: String(id) },
      });
    }
  }

  /** TODO(production): template sender for out-of-window messages (needs Meta-approved templates). */
  async sendTemplate(to: ContactRef, name: string, language = 'pt_BR', components: unknown[] = []): Promise<SendResult> {
    this.calls.push({
      method: 'POST',
      path: this.messagesPath(),
      body: {
        messaging_product: 'whatsapp',
        to: to.phone.replace(/\D/g, ''),
        type: 'template',
        template: { name, language: { code: language }, components },
      },
    });
    return { externalId: `wamid.stub-${randomUUID()}` };
  }

  isWithinServiceWindow(phone: string, now = Date.now()): boolean {
    const last = this.lastInboundAt.get(phone);
    return last !== undefined && now - last < SERVICE_WINDOW_MS;
  }

  /** GET webhook verification handshake. Returns the challenge to echo, or null to reply 403. */
  verifyWebhook(query: Record<string, string | undefined>): string | null {
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === this.opts.verifyToken) {
      return query['hub.challenge'] ?? '';
    }
    return null;
  }

  /**
   * POST webhook handler: parses a Cloud API payload and dispatches inbound messages.
   * TODO(production): verify X-Hub-Signature-256 first; download media by id (see header notes);
   * handle statuses[] (sent/delivered/read/failed) and smb_message_echoes (coexistence).
   */
  async handleWebhook(payload: unknown): Promise<InboundMessage[]> {
    const out: InboundMessage[] = [];
    const entries = (payload as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] })?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const phoneNumberId = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? this.opts.phoneNumberId;
        const tenantId = this.opts.tenantByPhoneNumberId[phoneNumberId] ?? phoneNumberId;
        const contacts = (value.contacts as { wa_id: string; profile?: { name?: string } }[] | undefined) ?? [];
        const messages = (value.messages as Record<string, unknown>[] | undefined) ?? [];
        for (const m of messages) {
          const from = String(m.from ?? '');
          const name = contacts.find((c) => c.wa_id === from)?.profile?.name ?? from;
          const type = String(m.type ?? 'text');
          const msg: InboundMessage = {
            tenantId,
            phone: from,
            name,
            type: type === 'audio' ? 'audio' : type === 'image' ? 'image' : 'text',
            text:
              type === 'text'
                ? ((m.text as { body?: string } | undefined)?.body ?? '')
                : type === 'image'
                  ? ((m.image as { caption?: string } | undefined)?.caption ?? null)
                  : null,
            mediaPath: null, // TODO(production): download media id and store the file name here
            externalId: String(m.id ?? ''),
          };
          this.lastInboundAt.set(from, Number(m.timestamp ?? 0) * 1000 || Date.now());
          if (msg.externalId) this.lastInboundWamid.set(from, msg.externalId);
          out.push(msg);
          for (const h of this.handlers) await h(msg);
        }
      }
    }
    return out;
  }
}
