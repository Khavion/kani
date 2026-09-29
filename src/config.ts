import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function detectWhisperx(): string | null {
  const explicit = process.env.WHISPERX_BIN;
  if (explicit) return explicit;
  const local = path.join(ROOT, '.local/venv-whisper/bin/whisperx');
  if (existsSync(local)) return local;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, 'whisperx');
    if (dir && existsSync(candidate)) return candidate;
  }
  return null;
}

export interface Config {
  port: number;
  ollamaUrl: string;
  model: string;
  altModel: string;
  visionModel: string;
  dbPath: string;
  whisperxBin: string | null;
  whisperModel: string;
  llmTimeoutMs: number;
  schedulerTickMs: number;
  mediaDir: string;
  reportsDir: string;
  uiDist: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const base: Config = {
    port: Number(env('PORT', '3000')),
    ollamaUrl: env('OLLAMA_URL', 'http://localhost:11434').replace(/\/$/, ''),
    model: env('MODEL', 'qwen3:8b'),
    altModel: env('ALT_MODEL', 'gemma3:12b'),
    visionModel: env('VISION_MODEL', 'gemma3:12b'),
    dbPath: path.resolve(ROOT, env('DB_PATH', 'data/kani.db')),
    whisperxBin: detectWhisperx(),
    whisperModel: env('WHISPER_MODEL', 'small'),
    llmTimeoutMs: Number(env('LLM_TIMEOUT_MS', '60000')),
    schedulerTickMs: Number(env('SCHEDULER_TICK_MS', '15000')),
    mediaDir: path.resolve(ROOT, env('MEDIA_DIR', 'data/media')),
    reportsDir: path.join(ROOT, 'reports'),
    uiDist: path.join(ROOT, 'ui/dist'),
  };
  return { ...base, ...overrides };
}
