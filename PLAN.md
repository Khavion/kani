# PLAN (living checklist)

Legend: [x] done and verified. All items complete as of 2026-09-29; see HANDOFF.md for open issues.

## 0. Environment
- [x] Ollama 0.32.6 running; qwen3:8b pulled; gemma3:12b pulled
- [x] whisperX: not installed system-wide; installed to `.local/venv-whisper` (whisperx 3.8.6), ffmpeg via imageio-ffmpeg; smoke-tested on a pt-BR voice note
- [x] Docker not installed: SQLite chosen (DECISIONS D2)

## 1. Stack
- [x] Node 26 + TS (type stripping), Fastify, node:sqlite, React + Vite, Playwright
- [x] `./start.sh` one-command startup (deps, models, whisperX, npm, UI build, migrate, seed, launch, open)
- [x] clean-clone verification of `./start.sh`
- [x] Makefile (start, dev, seed, test, typecheck, lint, run-scenarios, run-scenarios-ab, compare, pull-alt, e2e, fixtures)
- [x] `.env.example`

## 2. Modules
- [x] engine/: prompt composer, LLM client (tool loop max 4, single queue, 60s timeout), tools, guard, policies, memory
- [x] channels/: Channel interface, SimulatedChannel, WhatsAppCloudChannel stub with TODOs
- [x] scheduler/: reminders, reactivation, idle memory summaries, time travel endpoint
- [x] media/: whisperX wrapper, vision via Ollama
- [x] scenarios/: runner, scorer, HTML report, comparison page
- [x] report/: weekly metrics
- [x] ui/: WhatsApp Web style simulator, owner tab, /admin (verified against the live backend)
- [x] packs/ (5), scenarios data (5 x 15), seed/tenants.json
- [x] tests/, README, DECISIONS

## 3. Data model
- [x] migrations/0001_init.sql with all tables

## 4. Engine rules
- [x] verbatim base prompt, pack/tenant/tools/history/memory composition
- [x] tools executed against DB; offered slots carried across turns
- [x] guard with escalation + guard_violation event (quantity multiples, combos, installments allowed)
- [x] oficina quote approval, odonto price-on-ask
- [x] reminders 1/2, reactivation w/ opt-out, LGPD erase
- [x] take over / resume, auto-pause triggers
- [x] unbacked action claims repaired (never tell the customer something was booked when it was not)

## 5. Scenario runner + scoring
- [x] runner with customer simulator, audio + image paths, --live-vision
- [x] judge (strict JSON schema) + deterministic floors, rubric normalization, latency gate
- [x] HTML report per model, comparison page
- [x] full runs qwen3:8b (5 iterations: 91.6 -> 94.0, 73/75 shipped)
- [x] full run gemma3:12b (88.8, 52/75; latency gate is its main failure)
- [x] fix failures, re-run

## 9. Tests
- [x] guard, tools, scoring, channel contract, time travel, engine policies (53 passing)
- [x] Playwright E2E written (text, voice, photo, take over/resume, escalation, tenant switch, admin)
- [x] E2E run green with screenshots committed

## 10. Definition of done
- [x] start.sh from clean clone
- [x] chat text / voice / photo, owner take over (E2E 7/7)
- [x] run-scenarios for both models + reports + A/B page
- [x] /admin dashboard
- [x] all tests green (unit 53/53, E2E 7/7)
- [x] committed and pushed (continuously)
