// Kani server entrypoint: migrate + seed (idempotent), start HTTP API/UI and the scheduler.

import { createKani } from './app.ts';
import { buildServer } from './server/http.ts';

const k = createKani({ seed: 'demo' });
const app = await buildServer(k);
k.scheduler.start();
await app.listen({ port: k.cfg.port, host: '127.0.0.1' });
console.log(`[kani] listening on http://localhost:${k.cfg.port}  model=${k.engine.opts.model} vision=${k.cfg.visionModel}`);
console.log(`[kani] db=${k.cfg.dbPath} whisperx=${k.cfg.whisperxBin ?? 'not found'}`);

const shutdown = async () => {
  k.scheduler.stop();
  await app.close();
  k.db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
