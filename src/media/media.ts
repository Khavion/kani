// Media processing: whisperX (CLI) for voice notes and Ollama vision for images.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, type Config } from '../config.ts';
import { GenerationQueue, type LLM } from '../engine/llm.ts';

export interface Transcription {
  text: string;
  durationS: number | null;
}

export interface MediaService {
  transcribe(absPath: string): Promise<Transcription>;
  describeImage(absPath: string): Promise<string>;
  probeDuration(absPath: string): Promise<number | null>;
  readonly whisperxAvailable: boolean;
}

const LOCAL_BIN = path.join(ROOT, '.local/bin');

function mediaEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${LOCAL_BIN}${path.delimiter}${process.env.PATH ?? ''}`,
    HF_HOME: process.env.HF_HOME ?? path.join(ROOT, '.local/hf'),
    TORCH_HOME: process.env.TORCH_HOME ?? path.join(ROOT, '.local/torch'),
    PYTHONWARNINGS: 'ignore',
  };
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: mediaEnv() });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(cmd)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function ffmpegBin(): string {
  const local = path.join(LOCAL_BIN, 'ffmpeg');
  return existsSync(local) ? local : 'ffmpeg';
}

/** whisperX runs are CPU heavy: serialize them in their own queue (separate from the Ollama queue). */
const whisperQueue = new GenerationQueue();

export class LocalMediaService implements MediaService {
  private readonly cfg: Config;
  private readonly llm: LLM;

  constructor(cfg: Config, llm: LLM) {
    this.cfg = cfg;
    this.llm = llm;
  }

  get whisperxAvailable(): boolean {
    return !!this.cfg.whisperxBin && existsSync(this.cfg.whisperxBin);
  }

  async probeDuration(absPath: string): Promise<number | null> {
    try {
      const { stderr } = await run(ffmpegBin(), ['-hide_banner', '-i', absPath], 20_000);
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return null;
      const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      return Number.isFinite(s) && s > 0 ? Math.round(s * 10) / 10 : null;
    } catch {
      return null;
    }
  }

  transcribe(absPath: string): Promise<Transcription> {
    return whisperQueue.run(() => this.transcribeNow(absPath));
  }

  private async transcribeNow(absPath: string): Promise<Transcription> {
    const bin = this.cfg.whisperxBin;
    if (!bin || !existsSync(bin)) throw new Error('whisperX not available (run ./start.sh to install it)');
    const outDir = path.join(ROOT, '.local/tmp/whisperx', path.basename(absPath).replace(/\W/g, '_'));
    mkdirSync(outDir, { recursive: true });
    const args = [
      absPath,
      '--language',
      'pt',
      '--model',
      this.cfg.whisperModel,
      '--compute_type',
      'int8',
      '--output_format',
      'json',
      '--output_dir',
      outDir,
      '--model_dir',
      path.join(ROOT, '.local/whisper-models'),
      '--no_align',
      '--vad_method',
      'silero',
    ];
    const res = await run(bin, args, 240_000);
    const jsonFile = path.join(outDir, path.basename(absPath).replace(/\.[^.]+$/, '') + '.json');
    if (res.code !== 0 || !existsSync(jsonFile)) {
      throw new Error(`whisperX failed (code ${res.code}): ${res.stderr.split('\n').slice(-5).join(' ').slice(0, 400)}`);
    }
    const j = JSON.parse(readFileSync(jsonFile, 'utf8')) as { segments?: { text: string; end?: number }[] };
    rmSync(outDir, { recursive: true, force: true });
    const segments = j.segments ?? [];
    const text = segments
      .map((s) => s.text.trim())
      .join(' ')
      .trim();
    const durationS = segments.length ? (segments[segments.length - 1].end ?? null) : null;
    return { text, durationS: durationS ?? (await this.probeDuration(absPath)) };
  }

  async describeImage(absPath: string): Promise<string> {
    const b64 = (await readFile(absPath)).toString('base64');
    const res = await this.llm.chat({
      model: this.cfg.visionModel,
      label: 'vision',
      temperature: 0.2,
      numPredict: 90,
      timeoutMs: 120_000,
      messages: [
        {
          role: 'user',
          content:
            'Descreva objetivamente esta foto em portugues do Brasil, em uma frase curta (ate 25 palavras). ' +
            'Diga o que aparece e o estado visivel. Nao faca diagnostico, nao de valores, nao use travessao.',
          images: [b64],
        },
      ],
    });
    return res.content.replace(/\s+/g, ' ').replace(/[\u2013\u2014]/g, ',').trim();
  }
}
