// `make run-scenarios` / `npm run scenarios -- --model qwen3:8b [--packs oficina,salao] [--ids s01,s02]
//   [--live-vision] [--judge-model X] [--customer-model Y] [--max-turns N]`

import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, loadConfig } from '../config.ts';
import { runScenarios } from './runner.ts';
import { printTable, writeComparison, writeRunReport } from './report.ts';

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    packs: { type: 'string' },
    ids: { type: 'string' },
    'live-vision': { type: 'boolean', default: false },
    'judge-model': { type: 'string' },
    'customer-model': { type: 'string' },
    'max-turns': { type: 'string' },
    'compare-only': { type: 'boolean', default: false },
  },
});

const cfg = loadConfig();
const reportsDir = path.join(ROOT, 'reports');

if (values['compare-only']) {
  const file = writeComparison(reportsDir, [cfg.model, cfg.altModel]);
  console.log(file ? `[compare] ${path.relative(ROOT, file)}` : '[compare] need reports for at least two models');
  process.exit(0);
}

const model = values.model ?? cfg.model;
console.log(`[scenarios] model=${model} judge=${values['judge-model'] ?? model} customer=${values['customer-model'] ?? model} liveVision=${values['live-vision']}`);
const run = await runScenarios({
  model,
  judgeModel: values['judge-model'],
  customerModel: values['customer-model'],
  packs: values.packs?.split(',').map((s) => s.trim()).filter(Boolean),
  ids: values.ids?.split(',').map((s) => s.trim()).filter(Boolean),
  liveVision: values['live-vision'],
  maxTurns: values['max-turns'] ? Number(values['max-turns']) : undefined,
});
const out = writeRunReport(run, reportsDir);
console.log('\n' + printTable(run));
console.log(`\n[report] ${path.relative(ROOT, out.html)}`);
const cmp = writeComparison(reportsDir, [cfg.model, cfg.altModel]);
if (cmp) console.log(`[compare] ${path.relative(ROOT, cmp)}`);
