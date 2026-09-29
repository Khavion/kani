// Self-contained HTML reports for scenario runs and model A/B comparisons.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { AXES, AXIS_KEYS, type RunSummary, type ScenarioRecord } from './types.ts';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function modelSlug(model: string): string {
  return model.replace(/[^a-zA-Z0-9.]+/g, '_');
}

const CSS = `
:root{--bg:#f4f6f8;--card:#fff;--text:#111b21;--muted:#667781;--line:#e3e8ec;--ok:#15803d;--okbg:#dcfce7;--bad:#b91c1c;--badbg:#fee2e2;--warn:#b45309;--accent:#0f766e;--bubble-in:#fff;--bubble-out:#d9fdd3;--chat:#efeae2}
@media (prefers-color-scheme:dark){:root{--bg:#0b141a;--card:#111b21;--text:#e9edef;--muted:#8696a0;--line:#233138;--ok:#4ade80;--okbg:#14532d55;--bad:#f87171;--badbg:#7f1d1d55;--warn:#fbbf24;--accent:#2dd4bf;--bubble-in:#202c33;--bubble-out:#005c4b;--chat:#0b141a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
header{padding:24px 32px;background:var(--card);border-bottom:1px solid var(--line)}h1{margin:0 0 4px;font-size:22px}h2{font-size:17px;margin:28px 0 10px}
.muted{color:var(--muted)}main{padding:0 32px 48px;max-width:1400px;margin:0 auto}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.card b{display:block;font-size:26px;margin-top:4px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600}.pass{background:var(--okbg);color:var(--ok)}.fail{background:var(--badbg);color:var(--bad)}
.bar{height:8px;border-radius:4px;background:var(--line);min-width:90px;position:relative}.bar i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--accent)}
details{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:10px 0;padding:10px 14px}summary{cursor:pointer;font-weight:600}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:16px;margin-top:10px}@media (max-width:900px){.grid2{grid-template-columns:1fr}}
.chat{background:var(--chat);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;max-height:560px;overflow:auto}
.b{max-width:85%;padding:6px 9px;border-radius:8px;white-space:pre-wrap;box-shadow:0 1px .5px rgba(0,0,0,.13)}.b.customer{align-self:flex-end;background:var(--bubble-out)}.b.assistant,.b.owner{align-self:flex-start;background:var(--bubble-in)}
.b small{display:block;color:var(--muted);font-size:11px;margin-top:2px}.tool{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:var(--line);border-radius:4px;padding:0 4px;margin-right:4px}
.ok{color:var(--ok)}.bad{color:var(--bad)}code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.delta-pos{color:var(--ok);font-weight:600}.delta-neg{color:var(--bad);font-weight:600}
`;

function scoreBar(v: number): string {
  return `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
}

function recordDetails(r: ScenarioRecord): string {
  const checks = r.checks
    .map((c) => `<li class="${c.pass ? 'ok' : 'bad'}">${c.pass ? 'PASS' : 'FAIL'} <code>${esc(c.name)}</code> <span class="muted">${esc(c.detail)}</span></li>`)
    .join('');
  const axes = AXIS_KEYS.map((k) => {
    const a = r.axes[k];
    return `<tr><td>${esc(AXES[k].label)}</td><td>${a.score}/${a.max} <span class="muted">x${a.weight}</span></td><td>${esc(a.source)}</td><td>${esc(a.why)}</td></tr>`;
  }).join('');
  const chat = r.transcript
    .map((t) => {
      const meta = [
        t.tools?.length ? t.tools.map((x) => `<span class="tool">${esc(x)}</span>`).join('') : '',
        t.kind ? `<span class="tool">${esc(t.kind)}</span>` : '',
        t.guard ? `<span class="tool">price guard</span> raw: ${esc(t.rawText ?? '')}` : '',
        t.latencyMs ? secs(t.latencyMs) : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<div class="b ${esc(t.role)}">${esc(t.text)}${meta ? `<small>${meta}</small>` : ''}</div>`;
    })
    .join('');
  return `<details id="${esc(r.pack)}-${esc(r.scenario.id)}"><summary>${esc(r.pack)} ${esc(r.scenario.id)} ${esc(r.scenario.slug ?? '')}: ${r.score.toFixed(1)}
  <span class="pill ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'PASS' : 'FAIL'}</span></summary>
  <p class="muted"><b>Goal:</b> ${esc(r.scenario.title)}<br><b>Expect:</b> ${esc(r.scenario.expect)}<br><b>Ended by:</b> ${esc(r.endedBy)} | turns ${r.latency.turns.length} | p95 ${secs(r.latency.p95Ms)} | duration ${secs(r.durationMs)}${r.judgeError ? ` | judge error: ${esc(r.judgeError)}` : ''}${r.error ? ` | error: ${esc(r.error)}` : ''}</p>
  <div class="grid2"><div><h3>Checks</h3><ul>${checks}</ul><h3>Rubric</h3><table><tr><th>Axis</th><th>Score</th><th>Source</th><th>Why</th></tr>${axes}</table>
  <h3>Tool calls</h3><p>${r.toolCalls.map((t) => `<span class="tool">${esc(t.name)}${t.ok ? '' : ' (failed)'}</span>`).join(' ') || '<span class="muted">none</span>'}</p></div>
  <div><h3>Transcript</h3><div class="chat">${chat}</div></div></div></details>`;
}

export function renderRunHtml(run: RunSummary): string {
  const s = run.summary;
  const packRows = run.perPack
    .map(
      (p) =>
        `<tr><td>${esc(p.pack)}</td><td>${esc(p.tenantName)}</td><td>${p.avgScore.toFixed(1)}</td><td>${scoreBar(p.avgScore)}</td><td>${p.passed}/${p.total}</td><td>${secs(p.p95Ms)}</td></tr>`,
    )
    .join('');
  const rows = run.records
    .map((r) => {
      const failed = r.checks.filter((c) => !c.pass).map((c) => c.name);
      return `<tr><td>${esc(r.pack)}</td><td><a href="#${esc(r.pack)}-${esc(r.scenario.id)}">${esc(r.scenario.id)}</a></td><td>${esc(r.scenario.slug ?? '')}</td>
      <td>${r.score.toFixed(1)}</td><td>${scoreBar(r.score)}</td><td><span class="pill ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'PASS' : 'FAIL'}</span></td>
      <td>${failed.map((f) => `<code>${esc(f)}</code>`).join(' ')}</td><td>${r.latency.turns.length}</td><td>${secs(r.latency.p95Ms)}</td><td>${esc(r.endedBy)}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kani scenarios ${esc(run.model)}</title><style>${CSS}</style></head><body>
<header><h1>Kani scenario report: ${esc(run.model)}</h1><div class="muted">Judge ${esc(run.judgeModel)} | customer simulator ${esc(run.customerModel)} | ${esc(run.startedAt)} to ${esc(run.finishedAt)} | vision ${run.liveVision ? 'live (gemma3)' : 'scripted descriptions'}</div></header>
<main>
<div class="cards"><div class="card">Average score<b>${s.avgScore.toFixed(1)}</b></div><div class="card">Passed<b>${s.passed}/${s.total}</b></div>
<div class="card">Turn latency p95<b>${secs(s.latencyP95Ms)}</b></div><div class="card">Latency gate (p95 &le; 20s)<b>${s.latencyGatePassRate.toFixed(0)}%</b></div></div>
<h2>Per pack</h2><table><tr><th>Pack</th><th>Tenant</th><th>Avg</th><th></th><th>Passed</th><th>p95</th></tr>${packRows}</table>
<h2>Scenarios</h2><table><tr><th>Pack</th><th>ID</th><th>Scenario</th><th>Score</th><th></th><th>Result</th><th>Failed checks</th><th>Turns</th><th>p95</th><th>Ended</th></tr>${rows}</table>
<h2>Details</h2>${run.records.map(recordDetails).join('')}
<p class="muted">Rubric: grounding 0-3 (x2), action 0-3 (x2), escalation 0-2, Portuguese 0-2, tone 0-2, grievance 0-3 (x2), normalized to 0-100. Deterministic checks floor or override the judge. PASS = all checks green (incl. latency p95 &le; 20s) and score &ge; 70.</p>
</main></body></html>`;
}

export function writeRunReport(run: RunSummary, dir: string): { html: string; json: string } {
  mkdirSync(dir, { recursive: true });
  const stamp = run.startedAt.replace(/[-:]/g, '').replace(/\..+/, '');
  const base = path.join(dir, `scenarios-${stamp}-${modelSlug(run.model)}`);
  writeFileSync(`${base}.json`, JSON.stringify(run, null, 1));
  writeFileSync(`${base}.html`, renderRunHtml(run));
  return { html: `${base}.html`, json: `${base}.json` };
}

/** Latest full run per model found in the reports dir. */
export function latestRuns(dir: string): RunSummary[] {
  if (!existsSync(dir)) return [];
  const byModel = new Map<string, { file: string; run: RunSummary }>();
  for (const f of readdirSync(dir).filter((x) => /^scenarios-.*\.json$/.test(x)).sort()) {
    try {
      const run = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as RunSummary;
      const prev = byModel.get(run.model);
      // Prefer the most complete, then the most recent run.
      if (!prev || run.summary.total > prev.run.summary.total || (run.summary.total === prev.run.summary.total && f > prev.file)) {
        byModel.set(run.model, { file: f, run });
      }
    } catch {
      /* skip */
    }
  }
  return [...byModel.values()].map((v) => v.run);
}

export function renderCompareHtml(a: RunSummary, b: RunSummary): string {
  const delta = (x: number, y: number) => {
    const d = Math.round((y - x) * 10) / 10;
    return `<span class="${d > 0 ? 'delta-pos' : d < 0 ? 'delta-neg' : 'muted'}">${d > 0 ? '+' : ''}${d.toFixed(1)}</span>`;
  };
  const packs = [...new Set([...a.perPack.map((p) => p.pack), ...b.perPack.map((p) => p.pack)])];
  const packRows = packs
    .map((p) => {
      const pa = a.perPack.find((x) => x.pack === p);
      const pb = b.perPack.find((x) => x.pack === p);
      return `<tr><td>${esc(p)}</td><td>${pa ? pa.avgScore.toFixed(1) : '-'}</td><td>${pa ? `${pa.passed}/${pa.total}` : '-'}</td><td>${pa ? secs(pa.p95Ms) : '-'}</td>
      <td>${pb ? pb.avgScore.toFixed(1) : '-'}</td><td>${pb ? `${pb.passed}/${pb.total}` : '-'}</td><td>${pb ? secs(pb.p95Ms) : '-'}</td><td>${pa && pb ? delta(pa.avgScore, pb.avgScore) : ''}</td></tr>`;
    })
    .join('');
  const key = (r: ScenarioRecord) => `${r.pack}:${r.scenario.id}`;
  const mapB = new Map(b.records.map((r) => [key(r), r]));
  const rows = a.records
    .map((ra) => {
      const rb = mapB.get(key(ra));
      const cell = (r?: ScenarioRecord) =>
        r ? `${r.score.toFixed(1)} <span class="pill ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'PASS' : 'FAIL'}</span> <span class="muted">${secs(r.latency.p95Ms)}</span>` : '-';
      return `<tr><td>${esc(ra.pack)}</td><td>${esc(ra.scenario.id)} ${esc(ra.scenario.slug ?? '')}</td><td>${cell(ra)}</td><td>${cell(rb)}</td><td>${rb ? delta(ra.score, rb.score) : ''}</td></tr>`;
    })
    .join('');
  const axisRows = AXIS_KEYS.map((k) => {
    const avg = (run: RunSummary) => run.records.reduce((acc, r) => acc + r.axes[k].score, 0) / Math.max(1, run.records.length);
    return `<tr><td>${esc(AXES[k].label)} (0-${AXES[k].max})</td><td>${avg(a).toFixed(2)}</td><td>${avg(b).toFixed(2)}</td><td>${delta(avg(a), avg(b))}</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kani A/B ${esc(a.model)} vs ${esc(b.model)}</title><style>${CSS}</style></head><body>
<header><h1>Kani A/B: ${esc(a.model)} vs ${esc(b.model)}</h1><div class="muted">Runs: ${esc(a.startedAt)} (${esc(a.model)}) and ${esc(b.startedAt)} (${esc(b.model)}). Delta = B minus A.</div></header>
<main>
<div class="cards">
<div class="card">${esc(a.model)} avg<b>${a.summary.avgScore.toFixed(1)}</b><span class="muted">${a.summary.passed}/${a.summary.total} passed, p95 ${secs(a.summary.latencyP95Ms)}</span></div>
<div class="card">${esc(b.model)} avg<b>${b.summary.avgScore.toFixed(1)}</b><span class="muted">${b.summary.passed}/${b.summary.total} passed, p95 ${secs(b.summary.latencyP95Ms)}</span></div>
<div class="card">Score delta (B-A)<b>${delta(a.summary.avgScore, b.summary.avgScore)}</b></div>
<div class="card">Latency gate<b>${a.summary.latencyGatePassRate.toFixed(0)}% / ${b.summary.latencyGatePassRate.toFixed(0)}%</b></div></div>
<h2>Per pack</h2><table><tr><th>Pack</th><th>${esc(a.model)} avg</th><th>passed</th><th>p95</th><th>${esc(b.model)} avg</th><th>passed</th><th>p95</th><th>delta</th></tr>${packRows}</table>
<h2>Rubric axes (average)</h2><table><tr><th>Axis</th><th>${esc(a.model)}</th><th>${esc(b.model)}</th><th>delta</th></tr>${axisRows}</table>
<h2>Per scenario</h2><table><tr><th>Pack</th><th>Scenario</th><th>${esc(a.model)}</th><th>${esc(b.model)}</th><th>delta</th></tr>${rows}</table>
</main></body></html>`;
}

/** Writes compare-<a>-vs-<b>.html when reports for two or more models exist. Returns the path or null. */
export function writeComparison(dir: string, prefer: [string, string] = ['qwen3:8b', 'gemma3:12b']): string | null {
  const runs = latestRuns(dir);
  if (runs.length < 2) return null;
  const a = runs.find((r) => r.model === prefer[0]) ?? runs[0];
  const b = runs.find((r) => r.model === prefer[1] && r !== a) ?? runs.find((r) => r !== a)!;
  const file = path.join(dir, `compare-${modelSlug(a.model)}-vs-${modelSlug(b.model)}.html`);
  writeFileSync(file, renderCompareHtml(a, b));
  return file;
}

export function printTable(run: RunSummary): string {
  const lines = [
    `Model ${run.model}: avg ${run.summary.avgScore.toFixed(1)}, passed ${run.summary.passed}/${run.summary.total}, p95 ${secs(run.summary.latencyP95Ms)}`,
    'pack       | tenant                     | avg   | passed | p95',
    '-----------|----------------------------|-------|--------|------',
    ...run.perPack.map(
      (p) => `${p.pack.padEnd(10)} | ${p.tenantName.padEnd(26)} | ${p.avgScore.toFixed(1).padStart(5)} | ${`${p.passed}/${p.total}`.padStart(6)} | ${secs(p.p95Ms)}`,
    ),
  ];
  return lines.join('\n');
}
