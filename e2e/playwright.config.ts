import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(ROOT, '.local/ms-playwright');
const PORT = Number(process.env.E2E_PORT ?? 3200);

// The E2E server uses its own database and media dir so it never touches the demo data.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  testIgnore: /qa\//, // the full QA pass has its own config: e2e/qa/qa.config.ts (make qa)
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: path.join(ROOT, 'reports/tmp/playwright-report'), open: 'never' }]],
  outputDir: path.join(ROOT, 'reports/tmp/test-results'),
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm && node src/main.ts`,
    cwd: ROOT,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(PORT), DB_PATH: 'data/e2e.db', MEDIA_DIR: 'data/e2e-media', SCHEDULER_TICK_MS: '5000' },
  },
});
