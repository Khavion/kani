// Composition root: wires config, DB, engine, channel, scheduler. Used by main, tests and the scenario runner.

import { mkdirSync } from 'node:fs';
import { loadConfig, type Config } from './config.ts';
import { openDb, migrate, type DB } from './db/db.ts';
import { Repo } from './db/repo.ts';
import { Clock } from './util/time.ts';
import { EventHub } from './channels/hub.ts';
import { SimulatedChannel } from './channels/simulated.ts';
import type { Channel } from './channels/channel.ts';
import { OllamaClient, type LLM } from './engine/llm.ts';
import { LocalMediaService, type MediaService } from './media/media.ts';
import { Engine } from './engine/engine.ts';
import { Scheduler } from './scheduler/scheduler.ts';
import { seedDemoHistory, seedTenants } from './seed/seed.ts';

export interface Kani {
  cfg: Config;
  db: DB;
  repo: Repo;
  clock: Clock;
  hub: EventHub;
  channel: Channel;
  llm: LLM;
  media: MediaService | null;
  engine: Engine;
  scheduler: Scheduler;
}

export interface KaniOverrides {
  cfg?: Partial<Config>;
  llm?: LLM;
  media?: MediaService | null;
  channel?: Channel;
  clock?: Clock;
  seed?: 'none' | 'tenants' | 'demo';
  memorySummaries?: boolean;
  model?: string;
}

export function createKani(o: KaniOverrides = {}): Kani {
  const cfg = loadConfig(o.cfg);
  mkdirSync(cfg.mediaDir, { recursive: true });
  const db = openDb(cfg.dbPath);
  migrate(db);
  const clock = o.clock ?? new Clock();
  const repo = new Repo(db, clock);
  const seed = o.seed ?? 'demo';
  if (seed !== 'none') {
    seedTenants(repo);
    if (seed === 'demo') seedDemoHistory(repo, clock.now());
  }
  const hub = new EventHub();
  const channel = o.channel ?? new SimulatedChannel(hub);
  const llm = o.llm ?? new OllamaClient(cfg.ollamaUrl, { timeoutMs: cfg.llmTimeoutMs });
  const media = o.media === undefined ? new LocalMediaService(cfg, llm) : o.media;
  const engine = new Engine({
    repo,
    clock,
    llm,
    hub,
    channel,
    media,
    options: { model: o.model ?? cfg.model, mediaDir: cfg.mediaDir },
  });
  const scheduler = new Scheduler(engine, { tickMs: cfg.schedulerTickMs, memorySummaries: o.memorySummaries ?? true });
  return { cfg, db, repo, clock, hub, channel, llm, media, engine, scheduler };
}
