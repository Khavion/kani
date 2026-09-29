// Product rule: never use em-dashes (or en-dashes) in generated copy. Fails if any tracked text file has one.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.ts';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx|json|md|css|html|sql|sh|example)$/.test(f) && !f.startsWith('reports/') && f !== 'package-lock.json');
const bad: string[] = [];
for (const f of files) {
  let text: string;
  try {
    text = readFileSync(path.join(ROOT, f), 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    if (/[\u2013\u2014]/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}
if (bad.length) {
  console.error(`[dashes] ${bad.length} line(s) contain em/en dashes:\n` + bad.join('\n'));
  process.exit(1);
}
console.log(`[dashes] ok (${files.length} files checked)`);
