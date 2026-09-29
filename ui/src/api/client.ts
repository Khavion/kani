// Single entry point for all backend access. `?mock=1` in the page URL swaps the
// real HTTP client for the in-memory mock, nothing else in the UI changes.
import type { KaniApi, SimSendInput } from './types.ts';
import type { ServerEvent } from '../../../src/shared/api.ts';
import { createMockApi } from './mock.ts';

export const isMock = new URLSearchParams(window.location.search).get('mock') === '1';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${res.status} ${detail}`.trim());
  }
  return (await res.json()) as T;
}

function postJson<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// One shared EventSource for the whole page, with manual reconnect when the
// browser gives up (readyState CLOSED). If the stream delivers nothing within a few
// seconds (some proxies, e.g. Cloudflare quick tunnels, buffer SSE), fall back to
// polling /api/events/poll, which returns the same events.
const sseListeners = new Set<(e: ServerEvent) => void>();
let source: EventSource | null = null;
let reconnectTimer: number | null = null;
let sseAlive = false;
let polling = false;
let pollSeq = -1;

function dispatch(parsed: ServerEvent): void {
  sseListeners.forEach((l) => {
    try {
      l(parsed);
    } catch (err) {
      console.error('[kani] event listener failed', err);
    }
  });
}

function startPolling(): void {
  if (polling) return;
  polling = true;
  if (source) {
    source.close();
    source = null;
  }
  const tick = async () => {
    if (sseListeners.size === 0) {
      polling = false;
      return;
    }
    try {
      const res = await request<{ seq: number; events: ServerEvent[] }>(`/api/events/poll?since=${pollSeq}`);
      const first = pollSeq < 0;
      pollSeq = res.seq;
      if (!first) res.events.forEach(dispatch);
    } catch {
      /* retry on next tick */
    }
    window.setTimeout(tick, 1000);
  };
  void tick();
}

function openSource(): void {
  if (polling || source || sseListeners.size === 0) return;
  const es = new EventSource('/api/events');
  source = es;
  // Remember where the event log was when we connected, so a later fallback to polling
  // replays everything that happened in between (nothing is lost while we wait for the stream).
  if (pollSeq < 0) {
    void request<{ seq: number }>('/api/events/poll?since=-1')
      .then((r) => {
        if (pollSeq < 0) pollSeq = r.seq;
      })
      .catch(() => undefined);
  }
  window.setTimeout(() => {
    if (!sseAlive) startPolling();
  }, 4000);
  es.onmessage = (ev) => {
    sseAlive = true;
    let parsed: ServerEvent;
    try {
      parsed = JSON.parse(ev.data as string) as ServerEvent;
    } catch {
      return;
    }
    dispatch(parsed);
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      if (source === es) source = null;
      if (reconnectTimer === null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          openSource();
        }, 2000);
      }
    }
  };
}

const realApi: KaniApi = {
  health: () => request('/api/health'),
  tenants: () => request('/api/tenants'),
  simSession: (tenantId, phone, name) => postJson('/api/sim/session', { tenantId, phone, name }),
  simSend: (input: SimSendInput) => {
    const fd = new FormData();
    fd.append('tenantId', input.tenantId);
    fd.append('phone', input.phone);
    fd.append('name', input.name);
    fd.append('type', input.type);
    if (input.text !== undefined && input.text !== '') fd.append('text', input.text);
    if (input.durationS !== undefined && Number.isFinite(input.durationS)) fd.append('durationS', String(Math.round(input.durationS * 10) / 10));
    if (input.file) fd.append('file', input.file, input.fileName ?? (input.type === 'audio' ? 'audio.webm' : 'image.jpg'));
    return request('/api/sim/messages', { method: 'POST', body: fd });
  },
  simReset: (tenantId, phone) => postJson('/api/sim/reset', { tenantId, phone }),
  conversations: (tenantId) => request(`/api/conversations?tenantId=${encodeURIComponent(tenantId)}`),
  conversation: (id) => request(`/api/conversations/${id}`),
  takeover: (id) => postJson(`/api/conversations/${id}/takeover`),
  resume: (id) => postJson(`/api/conversations/${id}/resume`),
  ownerMessage: (id, text) => postJson(`/api/conversations/${id}/owner-messages`, { text }),
  resolveEscalation: (id) => postJson(`/api/escalations/${id}/resolve`),
  appointmentStatus: (id, status) => postJson(`/api/appointments/${id}/status`, { status }),
  metrics: (tenantId) => request(`/api/admin/metrics?tenantId=${encodeURIComponent(tenantId)}`),
  reports: () => request('/api/admin/reports'),
  timeTravel: (advanceHours) => postJson('/api/dev/time-travel', { advanceHours }),
  subscribe: (listener) => {
    sseListeners.add(listener);
    openSource();
    return () => {
      sseListeners.delete(listener);
      if (sseListeners.size === 0 && source) {
        source.close();
        source = null;
      }
    };
  },
};

export const api: KaniApi = isMock ? createMockApi() : realApi;
