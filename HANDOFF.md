# HANDOFF

Autonomous overnight build of the Kani prototype. This file is the morning briefing: what is done,
how good it is, what is still open, and how to resume.

## Status per Definition-of-Done item

| DoD item | Status | Evidence |
| --- | --- | --- |
| `./start.sh` from a clean clone, browser opens, 5 tenants ready | DONE | Verified from a fresh clone in `.local/clean-clone`: installed Python 3.12 + whisperX + ffmpeg into the clone's `.local/`, `npm ci`, UI build, migrate, seed (5 tenants), server healthy on its port. |
| Chat as a customer: text | DONE | E2E `customer sends text...` (price R$180 from the list, disclosure, blue ticks). |
| Chat as a customer: voice note | DONE | E2E `voice note upload...`: real whisperX transcript shown in the owner view (about 16s end to end). |
| Chat as a customer: photo through real vision | DONE | E2E `photo upload...`: gemma3:12b description shown in the owner view, bot answers without quoting a price for the photo. |
| Take over as owner | DONE | E2E `owner TAKE OVER...` and `escalation banner...` (TAKE OVER, owner reply reaches the customer, RESUME, resolve escalation). |
| `make run-scenarios` for both models | SEE BELOW | `reports/scenarios-*-qwen3_8b.html`, `reports/scenarios-*-gemma3_12b.html` |
| Scored HTML reports + A/B comparison | SEE BELOW | `reports/compare-qwen3_8b-vs-gemma3_12b.html` |
| English /admin dashboard | DONE | E2E `/admin renders...`; screenshots `admin-*.png`. |
| All tests green | DONE | `make test` (unit/integration), `make e2e` 7/7 with real models. |
| Everything committed and pushed to origin main | DONE | Pushed continuously via the `github.com-khavion` SSH alias. |

## Scenario scores per pack per model

SCORE_TABLE_PLACEHOLDER

## Open failures and hypotheses

OPEN_FAILURES_PLACEHOLDER

## Screenshot index (`reports/screenshots/`)

| File | What it shows |
| --- | --- |
| `chat-light.png`, `chat-dark.png` | Customer simulator: price question answered from the list, blue ticks, disclosure |
| `chat-voice-light.png`, `chat-voice-dark.png` | Voice note bubble (play control, waveform, duration) and the bot reply |
| `owner-voice-transcript-*.png` | Owner view with the whisperX transcript under the voice bubble, tool chips, latency |
| `owner-vision-*.png` | Owner view with the gemma3 vision description of the uploaded photo |
| `owner-takeover-*.png` | Conversation taken over, owner reply in the thread |
| `owner-escalation-*.png` | Escalation banner after "quero falar com um atendente humano" |
| `owner-inbox-*.png` | Owner inbox after switching tenant (Pet Care Perdizes) |
| `admin-*.png` | /admin weekly metrics, escalations, top questions, per-tenant table, report links |

## How to resume

```bash
./start.sh                                   # demo on http://localhost:3000
make check                                   # typecheck + dash lint + unit tests
make e2e                                     # Playwright with real models (about 1 minute)
make run-scenarios                           # qwen3:8b, about 30 minutes
make run-scenarios MODEL=gemma3:12b          # about 60 to 90 minutes
make compare                                 # rebuild the A/B page
node scripts/score-table.ts                  # Markdown score table for this file
```

Key files: engine `src/engine/engine.ts`, prompt `src/engine/prompt.ts`, guard
`src/engine/guard.ts`, policies `src/engine/policy.ts`, runner `src/scenarios/runner.ts`,
scorer `src/scenarios/scorer.ts`. Decisions are logged in `DECISIONS.md`; the checklist is `PLAN.md`.

## Iteration log

1. qwen3:8b iteration 1: avg 91.6, 68/75 passed, p95 8.5s. Seven failures, each diagnosed and fixed:
   guard false positive on a quantity multiple (2 x R$120), anger rule firing on "nunca mais vou
   conseguir hoje", symptom routed to the free suspension check instead of the R$120 diagnostic,
   price glued to duration ("R$90,15 min"), re-checking availability instead of booking the slot the
   customer picked, a promised handoff without an escalation, and clinical advice to a pregnant
   customer (sensitive topics now get deterministic, pre-approved replies).
2. E2E: first run 3/7 (test locator bug matched the list container), fixed, 7/7.
