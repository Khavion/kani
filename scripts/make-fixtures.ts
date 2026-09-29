// Generates offline test fixtures:
// - fixtures/audio/*.ogg|m4a: pt-BR voice notes synthesized with macOS `say` (voice Luciana) + ffmpeg
// - fixtures/images/<pack>.png: simple illustrations rendered with Playwright for the vision path
// Usage: node scripts/make-fixtures.ts

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.ts';
import { ffmpegBin } from '../src/media/media.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(ROOT, '.local/ms-playwright');
const audioDir = path.join(ROOT, 'fixtures/audio');
const imageDir = path.join(ROOT, 'fixtures/images');
mkdirSync(audioDir, { recursive: true });
mkdirSync(imageDir, { recursive: true });

const VOICE_NOTES: Record<string, string> = {
  'voice-note-oficina': 'mano, meu carro tá fazendo um barulho estranho na roda, tipo toc toc. Consegue ver isso pra mim hoje?',
  'voice-note-salao': 'oi amiga, queria fazer luzes. Quanto tá e tem horário no sábado?',
};

function makeAudio(): void {
  if (process.platform !== 'darwin') {
    console.log('[fixtures] skipping audio: macOS `say` not available');
    return;
  }
  for (const [name, text] of Object.entries(VOICE_NOTES)) {
    const aiff = path.join(audioDir, `${name}.aiff`);
    execFileSync('say', ['-v', 'Luciana', '-o', aiff, text]);
    execFileSync(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', aiff, '-c:a', 'libopus', '-b:a', '32k', path.join(audioDir, `${name}.ogg`)]);
    execFileSync(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', aiff, '-c:a', 'aac', '-b:a', '64k', path.join(audioDir, `${name}.m4a`)]);
    rmSync(aiff);
    console.log(`[fixtures] audio ${name}.ogg / .m4a`);
  }
}

const SCENES: Record<string, string> = {
  // Worn brake pad behind a scored disc
  oficina: `
    <rect width="800" height="600" fill="#6b7280"/><rect y="420" width="800" height="180" fill="#3f3f46"/>
    <circle cx="400" cy="300" r="250" fill="#18181b"/><circle cx="400" cy="300" r="205" fill="#27272a"/>
    <circle cx="400" cy="300" r="170" fill="#a1a1aa"/>
    ${Array.from({ length: 9 }, (_, i) => `<circle cx="400" cy="300" r="${95 + i * 8}" fill="none" stroke="#71717a" stroke-width="2"/>`).join('')}
    <circle cx="400" cy="300" r="70" fill="#52525b"/>
    ${Array.from({ length: 5 }, (_, i) => { const a = (i * 72 * Math.PI) / 180; return `<circle cx="${400 + 42 * Math.cos(a)}" cy="${300 + 42 * Math.sin(a)}" r="9" fill="#27272a"/>`; }).join('')}
    <path d="M520 150 Q600 300 520 450 L585 470 Q690 300 585 130 Z" fill="#b91c1c"/>
    <path d="M512 175 Q585 300 512 425 L522 428 Q596 300 522 172 Z" fill="#78350f"/>
    <path d="M505 182 Q575 300 505 418" fill="none" stroke="#1c1917" stroke-width="3"/>`,
  // Blotchy yellow highlights with frizzy dry ends
  salao: `
    <rect width="800" height="600" fill="#e7e5e4"/>
    ${Array.from({ length: 34 }, (_, i) => {
      const x = 120 + i * 17;
      const c = ['#d6a84a', '#e9c46a', '#b07d2b', '#f4d58d', '#8d5b2a'][i % 5];
      return `<path d="M${x} 40 C ${x + 40} 160, ${x - 30} 300, ${x + 20} 470" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round"/>
        <path d="M${x + 20} 470 l -14 60 M${x + 20} 470 l 6 64 M${x + 20} 470 l 22 52" stroke="${c}" stroke-width="3"/>`;
    }).join('')}
    <ellipse cx="330" cy="220" rx="70" ry="40" fill="#fef3c7" opacity=".55"/><ellipse cx="520" cy="320" rx="90" ry="45" fill="#fde68a" opacity=".5"/>`,
  // Lower molar with a dark spot on the chewing surface
  odonto: `
    <rect width="800" height="600" fill="#7f1d1d"/><rect y="330" width="800" height="270" fill="#f9a8b8"/>
    <path d="M250 330 C 240 180, 300 120, 360 150 C 390 120, 420 120, 450 150 C 510 120, 570 180, 550 330 Z" fill="#f5f5f4" stroke="#d6d3d1" stroke-width="4"/>
    <path d="M300 200 Q 400 250 500 200" fill="none" stroke="#d6d3d1" stroke-width="5"/>
    <ellipse cx="410" cy="215" rx="34" ry="22" fill="#44403c"/><ellipse cx="404" cy="212" rx="14" ry="9" fill="#1c1917"/>
    <path d="M120 330 C 110 220, 170 190, 210 220 C 230 330 Z" fill="#e7e5e4"/><path d="M590 330 C 600 220, 660 200, 690 240 L 700 330 Z" fill="#e7e5e4"/>`,
  // Pug belly with a reddish patch and a small hairless area
  pet: `
    <rect width="800" height="600" fill="#d6bc8a"/>
    ${Array.from({ length: 220 }, (_, i) => {
      const x = (i * 97) % 800;
      const y = (i * 53) % 600;
      return `<path d="M${x} ${y} l 6 14" stroke="#b89b66" stroke-width="2"/>`;
    }).join('')}
    <ellipse cx="420" cy="310" rx="150" ry="95" fill="#e8a0a0" opacity=".85"/>
    <ellipse cx="440" cy="300" rx="60" ry="38" fill="#f3c7b5"/><ellipse cx="400" cy="330" rx="90" ry="50" fill="#d97777" opacity=".45"/>
    <circle cx="250" cy="180" r="10" fill="#8b6b4a"/><circle cx="590" cy="190" r="10" fill="#8b6b4a"/>`,
  // Face with darker patches on cheeks and forehead
  estetica: `
    <rect width="800" height="600" fill="#e0e7ff"/>
    <ellipse cx="400" cy="320" rx="210" ry="260" fill="#d4a27f"/>
    <path d="M190 250 C 200 60, 600 60, 610 250 C 560 120, 240 120, 190 250 Z" fill="#3b2a20"/>
    <ellipse cx="400" cy="185" rx="95" ry="30" fill="#9c6b4b" opacity=".55"/>
    <ellipse cx="290" cy="360" rx="60" ry="45" fill="#9c6b4b" opacity=".6"/><ellipse cx="510" cy="360" rx="60" ry="45" fill="#9c6b4b" opacity=".6"/>
    <ellipse cx="330" cy="280" rx="26" ry="12" fill="#fff"/><circle cx="330" cy="280" r="9" fill="#3b2a20"/>
    <ellipse cx="470" cy="280" rx="26" ry="12" fill="#fff"/><circle cx="470" cy="280" r="9" fill="#3b2a20"/>
    <path d="M400 300 L 385 380 L 410 385" fill="none" stroke="#a87a5a" stroke-width="4"/>
    <path d="M345 445 Q 400 475 455 445" fill="none" stroke="#9f3a3a" stroke-width="7" stroke-linecap="round"/>`,
};

async function makeImages(): Promise<void> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  for (const [name, body] of Object.entries(SCENES)) {
    await page.setContent(`<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">${body}</svg></body></html>`);
    await page.screenshot({ path: path.join(imageDir, `${name}.png`) });
    console.log(`[fixtures] image ${name}.png`);
  }
  await browser.close();
}

makeAudio();
await makeImages();
if (!existsSync(path.join(imageDir, 'oficina.png'))) process.exit(1);
