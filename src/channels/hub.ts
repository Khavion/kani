// In-process pub/sub for server-sent events consumed by the web UI.
// Keeps a numbered ring buffer so clients behind proxies that buffer SSE (e.g. Cloudflare quick
// tunnels) can poll GET /api/events/poll?since=N instead.

import type { ServerEvent } from '../shared/api.ts';

export type Listener = (e: ServerEvent) => void;

const BUFFER_SIZE = 2000;

export class EventHub {
  private listeners = new Set<Listener>();
  private buffer: { seq: number; event: ServerEvent }[] = [];
  private seq = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: ServerEvent): void {
    this.seq++;
    this.buffer.push({ seq: this.seq, event: e });
    if (this.buffer.length > BUFFER_SIZE) this.buffer.splice(0, this.buffer.length - BUFFER_SIZE);
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* a broken subscriber must not break the engine */
      }
    }
  }

  /** Events after `since` (use -1 to just learn the current sequence number). */
  since(since: number): { seq: number; events: ServerEvent[] } {
    if (since < 0) return { seq: this.seq, events: [] };
    return { seq: this.seq, events: this.buffer.filter((b) => b.seq > since).map((b) => b.event) };
  }

  get size(): number {
    return this.listeners.size;
  }
}
