// In-process pub/sub for server-sent events consumed by the web UI.

import type { ServerEvent } from '../shared/api.ts';

export type Listener = (e: ServerEvent) => void;

export class EventHub {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: ServerEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* a broken subscriber must not break the engine */
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
