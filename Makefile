# Kani developer commands. `make help` lists them.
SHELL := /bin/bash
ROOT := $(shell pwd)
export PLAYWRIGHT_BROWSERS_PATH := $(ROOT)/.local/ms-playwright

MODEL ?= $(or $(shell grep -E '^MODEL=' .env 2>/dev/null | cut -d= -f2-),qwen3:8b)
ALT_MODEL ?= $(or $(shell grep -E '^ALT_MODEL=' .env 2>/dev/null | cut -d= -f2-),gemma3:12b)
ARGS ?=

.PHONY: help start dev seed test typecheck lint run-scenarios run-scenarios-ab compare pull-alt e2e fixtures check share qa

help:
	@echo "make start             one-command startup (same as ./start.sh)"
	@echo "make dev               API with --watch + Vite dev server (http://localhost:5173)"
	@echo "make seed              reset the local DB and reseed the 5 demo tenants + demo history"
	@echo "make test              unit/integration tests (node:test)"
	@echo "make typecheck         tsc for server and UI"
	@echo "make run-scenarios     75 scored scenarios, MODEL=qwen3:8b by default"
	@echo "                       e.g. make run-scenarios MODEL=gemma3:12b ARGS='--packs oficina --live-vision'"
	@echo "make run-scenarios-ab  run both MODEL and ALT_MODEL, then build the A/B comparison page"
	@echo "make pull-alt          ollama pull the alternative model ($(ALT_MODEL))"
	@echo "make e2e               Playwright E2E + screenshots (needs Ollama + models)"
	@echo "make fixtures          regenerate voice-note and image fixtures"
	@echo "make qa                full QA pass: 25 API flows + 16 UI tests with real models (~10 min)"
	@echo "make share             public https link to a running Kani (Cloudflare quick tunnel, no account)"

start:
	./start.sh

dev:
	@trap 'kill 0' EXIT; node --watch src/main.ts & npx vite --config ui/vite.config.ts; wait

seed:
	node src/seed/seed-cli.ts --reset

test:
	npm test

typecheck:
	npm run -s typecheck

lint:
	node scripts/check-dashes.ts

check: typecheck lint test

run-scenarios:
	node src/scenarios/cli.ts --model $(MODEL) $(ARGS)

run-scenarios-ab:
	node src/scenarios/cli.ts --model $(MODEL) $(ARGS)
	node src/scenarios/cli.ts --model $(ALT_MODEL) $(ARGS)
	node src/scenarios/cli.ts --compare-only

compare:
	node src/scenarios/cli.ts --compare-only

pull-alt:
	ollama pull $(ALT_MODEL)

e2e:
	npx playwright test -c e2e/playwright.config.ts

qa:
	npx playwright test -c e2e/qa/qa.config.ts

fixtures:
	node scripts/make-fixtures.ts

share:
	@test -x .local/bin/cloudflared || (mkdir -p .local/bin && curl -sSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz | tar -xz -C .local/bin)
	@curl -sf localhost:$${PORT:-3000}/api/health >/dev/null || (echo "Start Kani first: ./start.sh" && exit 1)
	.local/bin/cloudflared tunnel --no-autoupdate --url http://localhost:$${PORT:-3000}
