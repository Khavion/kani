import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(ROOT, '.local/ms-playwright');
export const QA_PORT = 3400;
export const QA_DB = path.join(ROOT, 'data/qa.db');

// Full QA pass: dedicated server, fresh database, real models. Serial on purpose (one Ollama queue).
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: path.join(ROOT, 'reports/qa/results.json') }]],
  outputDir: path.join(ROOT, 'reports/tmp/qa-results'),
  use: {
    baseURL: `http://localhost:${QA_PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  webServer: {
    command: 'rm -rf data/qa.db data/qa.db-wal data/qa.db-shm data/qa-media && node src/main.ts',
    cwd: ROOT,
    url: `http://localhost:${QA_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(QA_PORT), DB_PATH: 'data/qa.db', MEDIA_DIR: 'data/qa-media', SCHEDULER_TICK_MS: '3000' },
  },
});
