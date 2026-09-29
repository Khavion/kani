// `npm run migrate`: apply pending SQL migrations to DB_PATH.
import { loadConfig } from '../config.ts';
import { openDb, migrate } from './db.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const applied = migrate(db);
console.log(applied.length ? `[migrate] applied: ${applied.join(', ')}` : '[migrate] up to date');
db.close();
