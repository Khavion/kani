// HTTP API (Fastify): simulator, owner controls, admin metrics, dev clock, SSE, static UI.

import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { Kani } from '../app.ts';
import type { SimulatedChannel } from '../channels/simulated.ts';
import type { InboundMessage } from '../channels/channel.ts';
import type {
  ConversationDetailDTO,
  HealthDTO,
  MsgType,
  ReportLinkDTO,
  SimSessionResponse,
} from '../shared/api.ts';
import { computeWeeklyMetrics } from '../report/weekly.ts';
import { OllamaClient } from '../engine/llm.ts';
import { nextOpening } from '../scheduler/scheduler.ts';

const EXT: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/opus': '.ogg',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
};

function extFor(mime: string, filename: string): string {
  const fromName = path.extname(filename || '').toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return EXT[mime.split(';')[0].trim()] ?? '.bin';
}

export async function buildServer(k: Kani): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 30 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  const { repo, engine, scheduler, hub, clock, cfg } = k;

  // ---------------------------------------------------------------- health / tenants
  app.get('/api/health', async (): Promise<HealthDTO> => {
    let models: string[] = [];
    let ok = false;
    try {
      models = await new OllamaClient(cfg.ollamaUrl).listModels();
      ok = true;
    } catch {
      ok = false;
    }
    const whisperOk = !!k.media?.whisperxAvailable;
    return {
      ok,
      ollama: { ok, url: cfg.ollamaUrl, models },
      model: engine.opts.model,
      altModel: cfg.altModel,
      visionModel: cfg.visionModel,
      whisperx: { ok: whisperOk, bin: cfg.whisperxBin },
      now: clock.nowIso(),
      offsetHours: clock.offsetHours,
    };
  });

  app.get('/api/tenants', async () => repo.listTenants().map((t) => repo.tenantDTO(t)));

  // ---------------------------------------------------------------- simulator (customer side)
  app.post<{ Body: { tenantId: string; phone: string; name?: string } }>('/api/sim/session', async (req, reply) => {
    const { tenantId, phone, name } = req.body ?? ({} as never);
    if (!tenantId || !phone || !repo.getTenant(tenantId)) return reply.code(400).send({ error: 'tenantId and phone required' });
    const contact = repo.upsertContact(tenantId, phone, name ?? phone);
    const conv = repo.getOrCreateConversation(tenantId, contact.id);
    const res: SimSessionResponse = {
      conversation: repo.conversationDTO(conv),
      messages: repo.listMessages(conv.id).map((m) => repo.messageDTO(m)),
    };
    return res;
  });

  app.post<{ Body: { tenantId: string; phone: string } }>('/api/sim/reset', async (req, reply) => {
    const { tenantId, phone } = req.body ?? ({} as never);
    const c = tenantId && phone ? repo.findContact(tenantId, phone) : null;
    if (c) {
      repo.wipeContact(c.id);
      repo.logEvent(tenantId, 'sim_reset', {});
    }
    return reply.send({ ok: true });
  });

  app.post<{ Querystring: { wait?: string } }>('/api/sim/messages', async (req, reply) => {
    const fields: Record<string, string> = {};
    let mediaPath: string | null = null;
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const name = `${randomUUID()}${extFor(part.mimetype, part.filename)}`;
          await pipeline(part.file, createWriteStream(path.join(cfg.mediaDir, name)));
          mediaPath = name;
        } else {
          fields[part.fieldname] = String(part.value ?? '');
        }
      }
    } else {
      Object.assign(fields, (req.body as Record<string, string>) ?? {});
    }
    const tenantId = fields.tenantId;
    const phone = fields.phone;
    const type = (fields.type || 'text') as MsgType;
    if (!tenantId || !phone || !repo.getTenant(tenantId)) return reply.code(400).send({ error: 'tenantId and phone required' });
    if (!['text', 'audio', 'image'].includes(type)) return reply.code(400).send({ error: 'invalid type' });
    if (type === 'text' && !fields.text?.trim()) return reply.code(400).send({ error: 'text required' });
    if (type !== 'text' && !mediaPath) return reply.code(400).send({ error: 'file required' });
    let durationS = fields.durationS ? Number(fields.durationS) : null;
    if (type === 'audio' && mediaPath && (!durationS || !Number.isFinite(durationS))) {
      durationS = k.media ? await k.media.probeDuration(path.join(cfg.mediaDir, mediaPath)) : null;
    }
    const inbound: InboundMessage = {
      tenantId,
      phone,
      name: fields.name || phone,
      type,
      text: fields.text ?? null,
      mediaPath,
      durationS,
      ...(fields.simulatedTranscript ? { simulatedTranscript: fields.simulatedTranscript } : {}),
      ...(fields.imageDescription ? { imageDescription: fields.imageDescription } : {}),
    };
    const result = await engine.handleInbound(inbound);
    if (req.query.wait) {
      const turn = await result.done;
      return reply.code(201).send({
        message: repo.messageDTO(repo.getMessage(result.message.id) ?? result.message),
        reply: turn.reply ? repo.messageDTO(turn.reply) : null,
        turn: { escalated: turn.escalated, guard: turn.guardTriggered, tools: turn.toolCalls.map((c) => c.name), skipped: turn.skipped },
      });
    }
    result.done.catch((err) => console.error('[engine]', err));
    return reply.code(201).send({ message: repo.messageDTO(result.message) });
  });

  // ---------------------------------------------------------------- owner inbox
  app.get<{ Querystring: { tenantId?: string } }>('/api/conversations', async (req, reply) => {
    const tenantId = req.query.tenantId;
    if (!tenantId) return reply.code(400).send({ error: 'tenantId required' });
    return repo.listConversations(tenantId).map((c) => repo.conversationDTO(c));
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const conv = repo.getConversation(Number(req.params.id));
    if (!conv) return reply.code(404).send({ error: 'not found' });
    const res: ConversationDetailDTO = {
      conversation: repo.conversationDTO(conv),
      messages: repo.listMessages(conv.id).map((m) => repo.messageDTO(m)),
      appointments: repo.appointmentsForContact(conv.contactId).map((a) => repo.appointmentDTO(a)),
      quotes: repo.quotesForContact(conv.contactId).map((q) => repo.quoteDTO(q)),
    };
    return res;
  });

  app.post<{ Params: { id: string } }>('/api/conversations/:id/takeover', async (req, reply) => {
    try {
      return repo.conversationDTO(engine.takeOver(Number(req.params.id)));
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/conversations/:id/resume', async (req, reply) => {
    try {
      return repo.conversationDTO(engine.resume(Number(req.params.id)));
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });

  app.post<{ Params: { id: string }; Body: { text: string } }>('/api/conversations/:id/owner-messages', async (req, reply) => {
    const text = req.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: 'text required' });
    try {
      const msg = await engine.ownerMessage(Number(req.params.id), text);
      return { message: repo.messageDTO(msg) };
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/escalations/:id/resolve', async (req, reply) => {
    const esc = repo.getEscalation(Number(req.params.id));
    if (!esc) return reply.code(404).send({ error: 'not found' });
    repo.resolveEscalation(esc.id);
    engine.emitConversation(esc.conversationId);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { status: string } }>('/api/appointments/:id/status', async (req, reply) => {
    const appt = repo.getAppointment(Number(req.params.id));
    const status = req.body?.status;
    if (!appt) return reply.code(404).send({ error: 'not found' });
    if (!['done', 'no_show', 'cancelled', 'confirmed', 'booked'].includes(status)) return reply.code(400).send({ error: 'invalid status' });
    const updated = repo.updateAppointment(appt.id, { status: status as never });
    repo.logEvent(appt.tenantId, 'appointment_status', { appointment_id: appt.id, status, contact_id: appt.contactId });
    if (status === 'cancelled' || status === 'done' || status === 'no_show') repo.deleteUnsentReminders(appt.id);
    if (status === 'done') {
      void engine.sendReviewRequest(updated).catch((err) => console.error('[review]', err));
    }
    if (status === 'no_show') {
      const tenant = repo.getTenant(appt.tenantId)!;
      repo.insertReminder({
        appointmentId: appt.id,
        tenantId: appt.tenantId,
        contactId: appt.contactId,
        fireAt: nextOpening(tenant.hours, clock.now()).toISOString(),
        kind: 'reactivation',
      });
      void scheduler.tick();
    }
    const conv = repo.getOrCreateConversation(appt.tenantId, appt.contactId);
    engine.emitConversation(conv.id);
    return repo.appointmentDTO(updated);
  });

  // ---------------------------------------------------------------- admin
  app.get<{ Querystring: { tenantId?: string } }>('/api/admin/metrics', async (req) =>
    computeWeeklyMetrics(repo, { tenantId: req.query.tenantId ?? 'all' }),
  );

  app.get('/api/admin/reports', async (): Promise<ReportLinkDTO[]> => listReports(cfg.reportsDir));

  // ---------------------------------------------------------------- dev clock
  app.post<{ Body: { advanceHours?: number } }>('/api/dev/time-travel', async (req, reply) => {
    const hours = Number(req.body?.advanceHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 400) return reply.code(400).send({ error: 'advanceHours must be > 0' });
    const res = await scheduler.timeTravel(hours);
    hub.emit({ type: 'clock', now: res.now, offsetHours: res.offsetHours });
    return { now: res.now, offsetHours: res.offsetHours, fired: res.fired, reactivationsQueued: res.reactivationsQueued };
  });

  app.get('/api/dev/clock', async () => ({ now: clock.nowIso(), offsetHours: clock.offsetHours }));

  app.post('/api/dev/tick', async () => scheduler.tick());

  // ---------------------------------------------------------------- server-sent events
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`: connected\n\n`);
    const unsubscribe = hub.subscribe((e) => {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  // ---------------------------------------------------------------- WhatsApp Cloud webhook seam (stub)
  app.get<{ Querystring: Record<string, string> }>('/webhooks/whatsapp', async (req, reply) => {
    // TODO(production): use the tenant's WhatsAppCloudChannel.verifyWebhook with its verify token.
    const expected = process.env.WA_VERIFY_TOKEN;
    if (expected && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === expected) {
      return reply.type('text/plain').send(req.query['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ error: 'verification failed' });
  });

  // ---------------------------------------------------------------- static: media, reports, UI
  await app.register(fastifyStatic, { root: cfg.mediaDir, prefix: '/media/', decorateReply: false });
  await app.register(fastifyStatic, { root: cfg.reportsDir, prefix: '/reports/', decorateReply: false });
  const uiReady = existsSync(path.join(cfg.uiDist, 'index.html'));
  if (uiReady) {
    await app.register(fastifyStatic, { root: cfg.uiDist, prefix: '/', wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'not found' });
    if (uiReady) return reply.type('text/html').send(readFileSync(path.join(cfg.uiDist, 'index.html')));
    return reply
      .type('text/html')
      .send('<p style="font-family:sans-serif">Kani UI is not built yet. Run <code>npm run build:ui</code> or <code>./start.sh</code>.</p>');
  });

  return app;
}

export function listReports(dir: string): ReportLinkDTO[] {
  if (!existsSync(dir)) return [];
  const out: ReportLinkDTO[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.html')) continue;
    const full = path.join(dir, f);
    const kind: ReportLinkDTO['kind'] = f.startsWith('scenarios-') ? 'scenarios' : f.startsWith('compare') ? 'compare' : 'index';
    let model: string | null = null;
    let summary: ReportLinkDTO['summary'] = null;
    const sidecar = full.replace(/\.html$/, '.json');
    if (kind === 'scenarios' && existsSync(sidecar)) {
      try {
        const j = JSON.parse(readFileSync(sidecar, 'utf8')) as { model: string; summary: { avgScore: number; passed: number; total: number } };
        model = j.model;
        summary = j.summary;
      } catch {
        /* ignore broken sidecar */
      }
    }
    out.push({ file: f, url: `/reports/${f}`, kind, model, createdAt: statSync(full).mtime.toISOString(), summary });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type { SimulatedChannel };
