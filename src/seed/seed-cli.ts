// `npm run seed [-- --reset]`: seed demo tenants and one week of demo history.
import { rmSync } from 'node:fs';
import { loadConfig } from '../config.ts';
import { openDb, migrate } from '../db/db.ts';
import { Repo } from '../db/repo.ts';
import { Clock } from '../util/time.ts';
import { seedDemoHistory, seedTenants } from './seed.ts';

const cfg = loadConfig();
if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(cfg.dbPath + suffix, { force: true });
  console.log(`[seed] reset ${cfg.dbPath}`);
}
const db = openDb(cfg.dbPath);
migrate(db);
const clock = new Clock();
const repo = new Repo(db, clock);
const tenants = seedTenants(repo);
if (!process.argv.includes('--no-history')) seedDemoHistory(repo, clock.now());
console.log(`[seed] ${tenants.length} tenants ready: ${tenants.map((t) => t.name).join(', ')}`);
db.close();
