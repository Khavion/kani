// One contract suite, run against both channel implementations.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Channel, InboundMessage } from '../src/channels/channel.ts';
import { SimulatedChannel } from '../src/channels/simulated.ts';
import { WhatsAppCloudChannel } from '../src/channels/whatsapp-cloud.ts';
import { EventHub } from '../src/channels/hub.ts';

interface Harness {
  channel: Channel;
  /** Deliver an inbound customer message through the channel's native entry point. */
  inject(msg: { tenantId: string; phone: string; name: string; text: string }): Promise<void>;
  /** Number of outbound operations the channel recorded (sent messages, API calls). */
  outboundCount(): number;
}

const harnesses: Record<string, () => Harness> = {
  SimulatedChannel: () => {
    const channel = new SimulatedChannel(new EventHub());
    return {
      channel,
      inject: async (m) => {
        await channel.receive({ ...m, type: 'text' });
      },
      outboundCount: () => channel.outbox.length + channel.reads.length,
    };
  },
  WhatsAppCloudChannel: () => {
    const channel = new WhatsAppCloudChannel({ phoneNumberId: 'PNID', verifyToken: 'tok', tenantByPhoneNumberId: { PNID: 't1' } });
    return {
      channel,
      inject: async (m) => {
        await channel.handleWebhook({
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: 'PNID' },
                    contacts: [{ wa_id: m.phone, profile: { name: m.name } }],
                    messages: [{ from: m.phone, id: 'wamid.X', timestamp: '1760000000', type: 'text', text: { body: m.text } }],
                  },
                },
              ],
            },
          ],
        });
      },
      outboundCount: () => channel.calls.length,
    };
  },
};

for (const [name, make] of Object.entries(harnesses)) {
  describe(`Channel contract: ${name}`, () => {
    test('onMessage receives inbound text messages', async () => {
      const h = make();
      const got: InboundMessage[] = [];
      h.channel.onMessage((m) => {
        got.push(m);
      });
      await h.inject({ tenantId: 't1', phone: '5511999990000', name: 'Ana', text: 'oi, tem horario?' });
      assert.equal(got.length, 1);
      assert.equal(got[0].type, 'text');
      assert.equal(got[0].text, 'oi, tem horario?');
      assert.equal(got[0].phone, '5511999990000');
      assert.equal(got[0].tenantId, 't1');
    });

    test('send(text) returns an external id and records the outbound call', async () => {
      const h = make();
      const before = h.outboundCount();
      const res = await h.channel.send({ tenantId: 't1', phone: '5511999990000', conversationId: 1 }, { kind: 'text', text: 'Olá!' });
      assert.ok(res.externalId.length > 0);
      assert.equal(h.outboundCount(), before + 1);
    });

    test('send(media) is supported', async () => {
      const h = make();
      const res = await h.channel.send({ tenantId: 't1', phone: '5511999990000' }, { kind: 'media', mediaType: 'image', url: 'https://example.test/a.png', caption: 'foto' });
      assert.ok(res.externalId);
    });

    test('typing() and markRead() resolve without throwing', async () => {
      const h = make();
      await h.inject({ tenantId: 't1', phone: '5511999990000', name: 'Ana', text: 'oi' });
      await h.channel.typing({ tenantId: 't1', phone: '5511999990000', conversationId: 1 }, true);
      await h.channel.typing({ tenantId: 't1', phone: '5511999990000', conversationId: 1 }, false);
      await h.channel.markRead({ tenantId: 't1', phone: '5511999990000' }, ['wamid.X']);
      assert.ok(h.outboundCount() >= 1);
    });
  });
}

test('WhatsAppCloudChannel stub: webhook verification, 24h window and template sender', async () => {
  const ch = new WhatsAppCloudChannel({ phoneNumberId: 'PNID', verifyToken: 'tok' });
  assert.equal(ch.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '42' }), '42');
  assert.equal(ch.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' }), null);
  assert.equal(ch.isWithinServiceWindow('5511'), false);
  await ch.handleWebhook({ entry: [{ changes: [{ value: { messages: [{ from: '5511', id: 'w1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'oi' } }] } }] }] });
  assert.equal(ch.isWithinServiceWindow('5511'), true);
  await ch.sendTemplate({ tenantId: 't1', phone: '5511' }, 'confirm_24h');
  const last = ch.calls[ch.calls.length - 1];
  assert.equal((last.body as { type: string }).type, 'template');
});

test('EventHub: polling returns buffered events after a sequence number', () => {
  const hub = new EventHub();
  const start = hub.since(-1);
  assert.deepEqual(start.events, []);
  hub.emit({ type: 'clock', now: 'a', offsetHours: 0 });
  hub.emit({ type: 'clock', now: 'b', offsetHours: 0 });
  const next = hub.since(start.seq);
  assert.equal(next.events.length, 2);
  assert.equal(hub.since(next.seq).events.length, 0);
});
