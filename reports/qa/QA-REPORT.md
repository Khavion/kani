# Kani QA report (end-to-end pass, 2026-09-29)

Scope: the whole product, exercised the way users and operators use it: one-command startup, every
customer flow with the real models (qwen3:8b chat, gemma3:12b vision, whisperX voice), every UI control,
owner/admin tools, the scheduler, the public share link, failure modes and security.

## Results

| Suite | What it covers | Result |
| --- | --- | --- |
| Static | TypeScript 7 (server, UI, E2E), em-dash lint | green |
| Unit / integration (`make test`) | guard, tools, scoring, channel contract, time travel, engine policies, HTTP static/uploads, race conditions | **60 / 60** |
| QA flows (`make qa`, `e2e/qa/flows.spec.ts`) | 25 business flows over the HTTP API with real models, asserting on the database | **25 / 25** |
| QA UI (`make qa`, `e2e/qa/ui.spec.ts`) | 16 browser tests: every control, phone layout, SSE-blocked fallback, XSS | **16 / 16** |
| Original E2E (`make e2e`) | text, voice, photo, take over, escalation, tenant switch, /admin + screenshots | **7 / 7** |
| Negative / security probes (manual curl) | 25 malformed or hostile requests | all rejected correctly |
| Operations | clean clone `./start.sh`, port conflict, `--reset`, rebuild without restart, public link | pass |
| Benchmark regression | 75 scored scenarios, qwen3:8b, after all QA fixes | **93.1 avg, 73 / 75, p95 9.3 s** (previous 94.0, within run variance; 4 packs 15/15) |

Four QA iterations: 33/40, 39/41, 40/41, 41/41. Every failure was diagnosed to a root cause; product bugs
were fixed with a regression test, test bugs were fixed in the test.

## Coverage matrix

**Customer flows (real models):** price question with exact list price and one-time disclosure (F02);
multi-turn booking that creates a real appointment and future-only reminders (F03); reschedule without
duplicates, then deterministic cancel with reminders removed (F04); odonto price-only-when-asked (F05);
oficina quote with approval only on clear approval and `approval_message_id` stored (F06); human request,
bot silence, owner reply, resume (F07); take over and owner-typing pause (F08); sensitive topics in all four
health packs (F09); complaint vs DIY result (F10); spam close, ignore, reopen (F11); LGPD erasure of contact,
messages and events (F12); opt-out/opt-in (F13); price negotiation never yields an off-list price or discount
(F14); Pix key verbatim (F15); voice note through real whisperX and photo through real gemma3 vision (F16);
corrupt audio handled gracefully (F17); 5 simultaneous customers (F18, all answered in 39s through the single
generation queue); two messages from one customer 3 ms apart (F19); Ollama down: fallback reply, handoff,
health not ok (F20); reminders via time travel, "1" confirms, "2" reschedules (F21); owner marks done: Google
review request with the tenant link; no-show: guilt-free recovery (F22); reactivation after the pack window,
opt-out respected (F23); admin metrics equal direct SQL counts (F24); global invariants over every assistant
message of the run: no em-dashes, no leaked tool text, no off-list price or invented discount, no unbacked
booking claim, disclosure on first contact (F25).

**UI (browser):** Enter/Shift+Enter/mic-send swap (U01); emoji picker (U02); XSS stays text, no script runs
(U03); photo preview + caption, lightbox, vision in owner view (U04); mic recording with a fake microphone,
cancel and send (U05); voice-note player play/pause, duration, transcript (U06); profile rename reaches the
owner inbox (U07); "Limpar conversa" (U08); theme toggle and persistence (U09); unread badge (U10); owner
appointment "Done" sends the review request (U11); escalation banner, resolve, take over/resume (U12); live
updates with the SSE stream blocked (U13); admin filter, report links, time-travel buttons (U14); no overflow
and no console errors at 1280/1440/1920 (U15); phone layout at 375 px, customer and owner (U16).

**Security / negative:** missing or invalid fields (400), unknown ids (404), invalid status/time-travel
values (400), malformed JSON (400), path traversal on `/media` and `/reports` (403/404, the database is never
served), uploads over 25 MB (413), wrong file type for the message type (415), webhook verification without
token (403), unknown API routes (404).

## Bugs found and fixed

| # | Severity | Bug | Fix |
| --- | --- | --- | --- |
| 1 | Critical | Rebuilding the UI while the server ran produced new hashed assets the server could not serve: **blank page for every visitor** (hit the public link) | serve assets from disk (wildcard), 404 for missing assets instead of HTML, `no-cache` index; regression test |
| 2 | Critical | Phone layout unusable: conversation panel 0 px wide | list/conversation one at a time with back button, rail hidden in a conversation; U16 |
| 3 | High | Phone: composer collapsed to 0 px tall when its thread was mounted hidden | never pin a 0 px height; U16 |
| 4 | High | Race: a message arriving while the previous reply was generated was never answered | replies record `replyTo`; pending uses that cursor; unit test + F19 |
| 5 | High | Ignored spam made the next real question look like spam (question swallowed) | ignored messages marked handled; unit test + F11 |
| 6 | High | Stale reminders: "lembrar do seu horario ... as 10:00" sent at 13:00, after the appointment | overdue reminders for started appointments are skipped; seed never creates past "booked"; unit test |
| 7 | High | Uploads over the limit accepted silently (truncated file processed); no type check; orphan files on rejection | 413 / 415, cleanup on every rejection |
| 8 | Medium | Raw benchmark databases and QA JSON downloadable over the public link (`/reports/tmp/*.db`) | only published HTML reports and screenshots are served; unit test |
| 9 | Medium | Polling fallback lost events from the first seconds after page load | capture the event position at connect and replay from it; U13 |
| 10 | Medium | Regression from a recent fix: "posso pagar no pix?" hijacked into a price answer, Pix key never sent | price retry only for real price questions; unit test + F15 |
| 11 | Medium | "Fiz luzes em casa e ficou horrivel" escalated as an angry customer (lost sale) | self-done work excluded from anger rules; unit test + F10 |
| 12 | Low | "depois de amanha" misread (booked the next day) | calendar labels it explicitly, periods defined |
| 13 | Low | Seeded demo conversation started without the virtual-assistant disclosure | seed fixed |
| 14 | Low | `start.sh` touched the database before detecting a port conflict | port check moved before the DB step |
| 15 | Medium | Benchmark: model quoted "Pastilhas (dianteira, par)" x2 = R$700 (the list price already covers the pair) | `create_quote` rejects quantities > 1 for pair/package services and points the model to escalate off-list parts; oficina s08 now 100 |

## Not covered / known limits

- Real WhatsApp Cloud API delivery: the channel is a stub by design (contract-tested only).
- Load beyond one machine: one Ollama generation at a time; 5 concurrent customers take ~40 s end to end.
  Expect waits with many simultaneous testers.
- Benchmark leftovers: oficina s07 (spec expects the R$120 diagnostic, the model books the free suspension
  check for a wheel noise; arguably correct) and occasional judge-scored variance between runs.
- Model variance: flows that depend on the model's choices (booking, quotes) passed in these runs, but a
  local 8B model can still take a different path; the deterministic safety layer is what is guaranteed.
- Browsers: Chromium only (Playwright). Safari/iOS not tested.
- Public link has no authentication (by request).

## How to rerun

```bash
make check    # typecheck + lint + unit tests
make e2e      # original E2E with screenshots (~1 min)
make qa       # full QA pass (~10 min, real models, fresh isolated DB on port 3400)
```
