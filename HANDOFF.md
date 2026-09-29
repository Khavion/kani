# HANDOFF

Autonomous overnight build of the Kani prototype (2026-09-28 23:30 to 2026-09-29 ~05:00 local).
This is the morning briefing: what is done, how good it is, what is still open, and how to resume.

**Headline:** every Definition-of-Done item is green. On the shipped code, qwen3:8b scores
**94.0 / 100, 73 of 75 scenarios passed, p95 turn latency 9.1s**. In the fair A/B (both models on the
same engine commit) qwen3:8b beats gemma3:12b **91.2 vs 88.8**, with 69/75 vs 52/75 passed; gemma3
fails the 20s latency gate on 13 scenarios.

## End-to-end QA pass (2026-09-29)

A full QA pass is documented in [reports/qa/QA-REPORT.md](reports/qa/QA-REPORT.md): unit 61/61, QA flows
25/25 and QA UI 16/16 with real models (`make qa`), original E2E 7/7, clean-clone start verified, benchmark
after fixes 93.1 (73/75, p95 9.3s). It found and fixed 15 bugs, including a blank page after UI rebuilds,
an unusable phone layout, a race that dropped customer messages, stale reminders and upload validation gaps.
Public demo: `make share` (see README).

## Status per Definition-of-Done item

| DoD item | Status | Evidence |
| --- | --- | --- |
| `./start.sh` from a clean clone, browser opens, 5 tenants ready | DONE | Verified from a fresh clone (`.local/clean-clone`): installed Python 3.12 + whisperX 3.8.6 + ffmpeg into the clone's own `.local/`, `npm ci`, UI build, migrate, seed (5 tenants), server healthy. `open` launches the browser (skippable with `--no-open`). |
| Chat as a customer: text | DONE | E2E `customer sends text...`: price R$180 from the list, "assistente virtual" disclosure, ticks turn blue. |
| Chat as a customer: voice note | DONE | E2E `voice note upload...`: real whisperX transcript shown under the bubble in the owner view (about 14s end to end). |
| Chat as a customer: photo through real vision | DONE | E2E `photo upload...`: gemma3:12b description shown in the owner view (about 21s). |
| Take over as owner | DONE | E2E `owner TAKE OVER...` and `escalation banner...`: TAKE OVER, owner reply reaches the customer, RESUME, resolve escalation. |
| `make run-scenarios` for both models | DONE | 75 scenarios per model, unattended, reports in `reports/`. |
| Scored HTML reports + A/B comparison | DONE | `reports/scenarios-*.html` (+ `.json`), `reports/compare-qwen3_8b-vs-gemma3_12b.html`, all linked from `/admin`. |
| English /admin dashboard | DONE | E2E `/admin renders...`; screenshots `admin-*.png`. |
| All tests green | DONE | `make test`: 53/53. `make e2e`: 7/7 with real models. `make typecheck` and `make lint` clean. |
| Everything committed and pushed to origin main | DONE | Pushed continuously (SSH alias `github.com-khavion`; only the push URL was changed, fetch stays HTTPS). |

## Scenario scores per pack per model

**Fair A/B, both on engine commit `bc0827a`** (`reports/compare-qwen3_8b-vs-gemma3_12b.html`):

| Pack | qwen3:8b avg | passed | p95 | gemma3:12b avg | passed | p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| estetica | 91.1 | 14/15 | 9.3s | 93.3 | 13/15 | 17.1s |
| odonto | 95.6 | 14/15 | 9.6s | 90.6 | 13/15 | 14.6s |
| oficina | 88.1 | 14/15 | 9.0s | 89.5 | 9/15 | 20.1s |
| pet | 88.9 | 13/15 | 8.6s | 83.6 | 9/15 | 20.6s |
| salao | 92.2 | 14/15 | 8.0s | 87.0 | 8/15 | 20.5s |
| **all** | **91.2** | **69/75** | 9.0s | **88.8** | **52/75** | 20.1s |

**Shipped code, qwen3:8b** (`reports/scenarios-20260929T094345-qwen3_8b.html`, commit `344bbf7`):

| Pack | avg | passed | p95 |
| --- | ---: | ---: | ---: |
| estetica | 97.8 | 15/15 | 9.7s |
| odonto | 97.2 | 15/15 | 9.5s |
| oficina | 89.5 | 14/15 | 8.7s |
| pet | 87.8 | 14/15 | 8.6s |
| salao | 97.8 | 15/15 | 8.2s |
| **all** | **94.0** | **73/75** | 9.1s |

After this run one more generic fix landed (commit after `344bbf7`): if the customer asks a price and the
reply states none, the model is retried once with a note to answer from the list. It fixed pet s07 and was
verified on a targeted run of s01/s07/s11 across all packs (13/15; the 2 misses are open items 1 and 2).

Iteration history (qwen3:8b, full runs): 91.6 (68/75) -> 92.4 (70/75) -> 92.4 (71/75) -> 91.2 (69/75,
A/B commit) -> **94.0 (73/75, shipped)**. Same-model runs vary by a few points because the simulated
customer runs at temperature 0.8.

**Recommendation:** use qwen3:8b as the production model on this hardware. gemma3:12b's content quality
is close (it even wins estetica), but 13 of its 23 failures are latency-only: it misses the p95 20s gate
because it has no native tool calling (prompted JSON protocol adds a round trip) and is slower per token.
Keep gemma3:12b as the vision model.

## Open failures and hypotheses

1. **oficina s07 (voice note, wheel noise) expects the R$120 scanner diagnostic; the bot books the free
   "Suspensao (avaliacao)".** Both are list services; for a "toc toc na roda" noise the suspension check is
   arguably the better answer. The scenario's `must_include: ["120"]` came from the spec, so it stays and
   fails honestly. Decide: accept either service in the scenario, or add an owner-editable routing hint.
2. **Run-to-run variance** on judge-scored scenarios (for example pet s11 passed in the full run and scored
   66.7 in a targeted rerun). Hypothesis: temperature-0.8 customer simulator plus the same small model as
   judge. Options: `--judge-model` with a larger local model, or averaging 3 runs per scenario.
3. **gemma3:12b latency** (see above) and occasional verbatim repetition / weekday-date slips ("quarta-feira,
   dia 8" when the 8th is a Thursday). A calendar line is already in the prompt; a deterministic date/weekday
   validator on replies would catch the rest.
4. **Policy layer is regex-based pt-BR.** Every false positive and negative found overnight is covered by a
   test, but new phrasings will appear with real customers. Production path: log `claim_repair`,
   `guard_violation`, `clinical_advice_removed` events (already emitted) and review them weekly.

Fixed during the night (all with tests): unbacked "agendado/cancelei/cancelamos/agendamento feito" claims
now repaired before delivery; book-instead-of-reschedule double bookings; guard false positive on quantity
multiples; invented discounts blocked; sensitive topics get deterministic safe replies; complaints and
promised handoffs always escalate; deterministic yes/no confirmations and cancellations; clinical treatment
recommendations stripped in health packs; schema-wrapped tool arguments from gemma3 unwrapped; leaked
`/no_think` tokens removed.

## Screenshot index (`reports/screenshots/`, light and dark for each)

| File | What it shows |
| --- | --- |
| `chat-*.png` | Customer simulator: price question answered from the list, blue ticks, disclosure |
| `chat-voice-*.png` | Voice note bubble (play control, waveform, duration) and the bot reply |
| `owner-voice-transcript-*.png` | Owner view with the whisperX transcript under the voice bubble, tool chips, latency |
| `owner-vision-*.png` | Owner view with the gemma3 vision description of the uploaded photo |
| `owner-takeover-*.png` | Conversation taken over, owner reply in the thread |
| `owner-escalation-*.png` | Escalation banner after "quero falar com um atendente humano" |
| `owner-inbox-*.png` | Owner inbox after switching tenant (Pet Care Perdizes) |
| `admin-*.png` | /admin weekly metrics, escalations, top questions, per-tenant table, report links |

## How to resume

```bash
./start.sh                                   # demo on http://localhost:3000 (admin: /admin)
make check                                   # typecheck + dash lint + unit tests
make e2e                                     # Playwright with real models (about 1 minute)
make run-scenarios                           # qwen3:8b, about 30 minutes
make run-scenarios MODEL=gemma3:12b          # about 2.5 hours
make compare                                 # rebuild the A/B page from the latest run per model
node scripts/score-table.ts                  # Markdown score table
```

Note: `make compare` pairs the *latest* run per model. The committed comparison page was generated from
the two runs on the same commit (`bc0827a`); re-run both models before regenerating it.

Key files: engine `src/engine/engine.ts`, prompt `src/engine/prompt.ts`, guard `src/engine/guard.ts`,
policies `src/engine/policy.ts`, tools `src/engine/tools.ts`, runner `src/scenarios/runner.ts`, scorer
`src/scenarios/scorer.ts`. Decisions are logged in `DECISIONS.md`; the checklist is `PLAN.md`.

Local state (gitignored, in `.local/`): whisperX venv, model caches, Playwright browsers, logs of every
run (`.local/run-*.log`), and the clean-clone check.
