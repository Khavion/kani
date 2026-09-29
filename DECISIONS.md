# Decisions

Autonomous build log. Each entry: the call, and why. Newest last.

## D1. Runtime: Node 26 + TypeScript with native type stripping (no build step for the server)
Node 26 runs `.ts` directly (`process.features.typescript === 'strip'`), so the server, tests, scenario
runner and CLIs execute without a compiler or bundler. `tsc --noEmit` (TypeScript 7) is the type gate
(`npm run typecheck`). Code uses only erasable syntax (`erasableSyntaxOnly`), explicit `.ts` imports.

## D2. Database: SQLite via built-in `node:sqlite`, SQL migrations, Postgres as the production path
- Docker is not installed on this Mac, so Postgres-in-Docker was not an option for one-command startup.
- `node:sqlite` ships with Node (SQLite 3.53): zero native addons, nothing to compile, WAL mode.
- Schema lives in `migrations/NNNN_name.sql` (applied in order, tracked in `schema_migrations`).
  Row types and DTO mappers are in `src/db/repo.ts`; all SQL is in that one module.
- Production path: the SQL is plain ANSI apart from `json_extract` and `INTEGER PRIMARY KEY AUTOINCREMENT`
  (map to `jsonb ->>` and `bigserial`). Swap `Repo` for a Postgres implementation behind the same methods.

## D3. HTTP: Fastify 5, Server-Sent Events for realtime
SSE (`GET /api/events`) is enough for one-way push (new messages, ticks, typing, escalations) and
needs no extra dependency or protocol upgrade. Uploads via `@fastify/multipart`.

## D4. UI: React 19 + Vite, served by the same server from `ui/dist`
One port for API + UI. `npm run dev:ui` gives a Vite dev server with a proxy for development.

## D5. whisperX installed into a repo-local venv (`.local/venv-whisper`) with uv
whisperX was not installed on the machine. It is installed with `uv` into `.local/` (Python 3.12,
whisperx 3.8.6), keeping everything inside the repo. ffmpeg (required by whisperX) comes from the
`imageio-ffmpeg` wheel and is symlinked to `.local/bin/ffmpeg`. Model caches (`HF_HOME`,
`TORCH_HOME`, `--model_dir`) also point into `.local/`.
- Flags beyond the spec command: `--no_align` (we only need text; alignment would download a 1.2 GB
  wav2vec2 model) and `--vad_method silero` (pyannote VAD may need a HF token). Measured: correct
  transcript of a pt-BR slang voice note.

## D6. Playwright browsers in `.local/ms-playwright`
`PLAYWRIGHT_BROWSERS_PATH` points inside the repo to honor "never touch files outside this repo".

## D7. gemma3:12b has no native tool calling in Ollama: prompted-JSON tool protocol
`/api/show` reports `capabilities: [completion, vision]` for gemma3:12b. The LLM client checks
capabilities; for models without `tools` the engine appends a JSON tool protocol to the system prompt
(`{"tool": "...", "args": {...}}`) and parses calls from text. qwen3:8b uses native tools with
`think: false` (thinking off for latency). The text parser also rescues qwen3 when it writes a call as text.

## D8. Deterministic policy layer around the LLM
Code (not the model) enforces: price guard, human-request handoff, LGPD erasure, opt-out, spam
closure, reminder 1/2 answers, oficina quote approval, forced escalation on sensitive topics or angry
customers (after one safe reply), two-low-confidence-turns pause, disclosure of "assistente virtual" on
first contact, em-dash stripping. The model is told the same rules; code is the safety net.
Tool calls are recorded with `source` so reports can tell model behavior from policy behavior.

## D9. Price guard allowances
The guard blocks any R$ value or price-like numeral not backed by the tenant list. Allowed derived
values: `0`, list prices, quantity multiples (2..10 x one list price, e.g. "2 sessoes = R$240"),
totals of quotes created by `create_quote` in the conversation, installments
(`p/n`, n = 2..12, only when the text mentions `Nx`/parcelas), and sums of two list prices (salao combos:
"informe faixa apenas se ambos os itens estiverem na lista"). Customer-quoted values (competitor prices)
are NOT allowed: echoing "voces fazem por 100?" would otherwise pass a negotiated price.
Bare numerals count as prices only with price context (R$, "reais", price verbs, or a service name in
the same sentence) and never when followed by units (h, min, dias, anos, x, %, Ah...) or when they are
times, dates, years, phone numbers, the pix key, address numbers or links.

## D10. Odonto "price only when asked"
If the last customer message does not ask about price, sentences containing prices are stripped from
the reply (event `price_suppressed`).

## D11. Customer-facing copy uses accents
The spec text is written without accents; customer-facing pt-BR templates use proper accents
("já", "horário"). The verbatim system prompt skeleton stays exactly as written in the spec.
The guard fallback reply is "vou confirmar esse valor certinho e já te retorno".

## D12. Time: Sao Paulo is fixed UTC-3
Brazil abolished DST in 2019. All scheduling uses a fixed -03:00 offset (deterministic, no ICU
dependency). Timestamps are stored as ISO UTC strings. A process `Clock` supports an offset
(`POST /api/dev/time-travel`) and a frozen mode for deterministic scenario runs.

## D13. One conversation per (tenant, contact)
WhatsApp-style single thread per contact. `closed` (spam) reopens on the next non-spam message.
LGPD erasure deletes the contact (cascade) and starts a fresh empty thread for the confirmation message.

## D14. Reminders
`book` schedules the pack's default reminders (confirm_24h / confirm_2h) deterministically;
`schedule_reminder` stays available to the model. Reminder copy is templated (no LLM) and always
contains "Responda 1 para confirmar, 2 para remarcar". Reactivation reminders reference the contact's
last `done` appointment (the `reminders` table requires an appointment id); a `no_show` appointment
produces the guilt-free no-show recovery copy. Review requests (post-service) are LLM-written with a
template fallback and are logged as `review_requested` events (not a reminders kind).

## D15. Seeded demo history
`seed` creates the 5 tenants plus a deterministic week of history per tenant (price questions,
bookings with confirmed reminders, a no-show, a reactivated customer, escalations, oficina quotes) so
`/admin` renders real numbers on first boot. All seeded prices come from the tenant's list.
