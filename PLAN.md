# PLAN (living checklist)

Legend: [x] done and verified, [~] in progress / partial, [ ] not started.

## 0. Environment
- [x] Ollama 0.32.6 running; qwen3:8b pulled; gemma3:12b pulled
- [x] whisperX: not installed system-wide; installed to `.local/venv-whisper` (whisperx 3.8.6), ffmpeg via imageio-ffmpeg; smoke-tested on a pt-BR voice note
- [x] Docker not installed: SQLite chosen (DECISIONS D2)

## 1. Stack
- [x] Node 26 + TS (type stripping), Fastify, node:sqlite, React + Vite, Playwright
- [ ] `./start.sh` one-command startup
- [ ] Makefile (dev, seed, test, run-scenarios, pull-alt)
- [x] `.env.example`

## 2. Modules
- [x] engine/: prompt composer, LLM client (tool loop max 4, single queue, 60s timeout), tools, guard, policies, memory
- [x] channels/: Channel interface, SimulatedChannel, WhatsAppCloudChannel stub with TODOs
- [x] scheduler/: reminders, reactivation, time travel endpoint
- [x] media/: whisperX wrapper, vision via Ollama
- [ ] scenarios/: runner, scorer, HTML report, comparison page
- [x] report/: weekly metrics
- [~] ui/: WhatsApp Web style simulator, owner tab, /admin (built by a parallel agent)
- [x] packs/ (5), [x] scenarios data (5 x 15), [x] seed/tenants.json
- [ ] tests/, README

## 3. Data model
- [x] migrations/0001_init.sql with all tables

## 4. Engine rules
- [x] verbatim base prompt, pack/tenant/tools/history/memory composition
- [x] tools executed against DB
- [x] guard with escalation + guard_violation event
- [x] oficina quote approval, odonto price-on-ask
- [x] reminders 1/2, reactivation w/ opt-out, LGPD erase
- [x] take over / resume, auto-pause triggers

## 5. Scenario runner + scoring
- [ ] runner with customer simulator, audio + image paths, --live-vision
- [ ] judge + deterministic floors, rubric normalization, latency gate
- [ ] HTML report per model, comparison page

## 9. Tests
- [ ] guard, tools, scoring, channel contract, time travel

## 10. Definition of done
- [ ] start.sh from clean clone
- [ ] chat text / voice / photo, owner take over
- [ ] run-scenarios for both models + reports + A/B page
- [ ] /admin dashboard
- [ ] all tests green; E2E with screenshots
- [ ] committed and pushed
