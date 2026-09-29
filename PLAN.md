# PLAN (living checklist)

Legend: [x] done and verified, [~] in progress / partial, [ ] not started.

## 0. Environment
- [x] Ollama 0.32.6 running; qwen3:8b pulled; gemma3:12b pulled
- [x] whisperX: not installed system-wide; installed to `.local/venv-whisper` (whisperx 3.8.6), ffmpeg via imageio-ffmpeg; smoke-tested on a pt-BR voice note
- [x] Docker not installed: SQLite chosen (DECISIONS D2)

## 1. Stack
- [x] Node 26 + TS (type stripping), Fastify, node:sqlite, React + Vite, Playwright
- [x] `./start.sh` one-command startup (deps, models, whisperX, npm, UI build, migrate, seed, launch, open)
- [~] clean-clone verification of `./start.sh`
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
- [~] full run qwen3:8b (iteration 1 running)
- [ ] full run gemma3:12b
- [ ] fix failures, re-run

## 9. Tests
- [x] guard, tools, scoring, channel contract, time travel, engine policies (41 passing)
- [x] Playwright E2E written (text, voice, photo, take over/resume, escalation, tenant switch, admin)
- [ ] E2E run green with screenshots committed

## 10. Definition of done
- [~] start.sh from clean clone
- [x] chat text / voice / photo, owner take over (manually verified in the browser pane; E2E pending)
- [ ] run-scenarios for both models + reports + A/B page
- [x] /admin dashboard
- [~] all tests green (unit yes); E2E pending
- [x] committed and pushed (continuously)
