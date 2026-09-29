// Prints a Markdown table of scenario scores per pack per model (latest full run per model).
// Usage: node scripts/score-table.ts
import path from 'node:path';
import { ROOT } from '../src/config.ts';
import { latestRuns } from '../src/scenarios/report.ts';

const runs = latestRuns(path.join(ROOT, 'reports'));
if (runs.length === 0) {
  console.log('_No scenario reports yet. Run `make run-scenarios`._');
  process.exit(0);
}
const packs = [...new Set(runs.flatMap((r) => r.perPack.map((p) => p.pack)))];
const header = `| Pack | ${runs.map((r) => `${r.model} avg | passed | p95`).join(' | ')} |`;
const sep = `| --- | ${runs.map(() => '---: | ---: | ---:').join(' | ')} |`;
const rows = packs.map((pack) => {
  const cells = runs.map((r) => {
    const p = r.perPack.find((x) => x.pack === pack);
    return p ? `${p.avgScore.toFixed(1)} | ${p.passed}/${p.total} | ${(p.p95Ms / 1000).toFixed(1)}s` : '- | - | -';
  });
  return `| ${pack} | ${cells.join(' | ')} |`;
});
const total = `| **all** | ${runs
  .map((r) => `**${r.summary.avgScore.toFixed(1)}** | **${r.summary.passed}/${r.summary.total}** | ${(r.summary.latencyP95Ms / 1000).toFixed(1)}s`)
  .join(' | ')} |`;
console.log([header, sep, ...rows, total].join('\n'));
console.log('');
for (const r of runs) {
  const failed = r.records.filter((x) => !x.passed);
  console.log(`**${r.model}** (${r.startedAt}): ${failed.length} failing: ${failed.map((x) => `${x.pack}/${x.scenario.id} ${x.scenario.slug ?? ''} (${x.checks.filter((c) => !c.pass).map((c) => c.name).join(', ') || `score ${x.score}`})`).join('; ') || 'none'}`);
  console.log('');
}
