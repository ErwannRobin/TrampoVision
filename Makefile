.DEFAULT_GOAL := help
.PHONY: worker-dev worker-check worker-deploy help install dev build preview typecheck lint format format-check test test-watch check assets convert clean distclean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

install: node_modules ## Install deps (also fetches MediaPipe assets, needs internet once)

dev: node_modules ## Start dev server on http://localhost:5173
	npm run dev

build: node_modules ## Typecheck + production build into dist/
	npm run build

preview: build ## Serve the production build locally
	npm run preview

typecheck: node_modules ## Typecheck only
	npm run typecheck

lint: node_modules ## Lint with oxlint
	npm run lint

format: node_modules ## Format all files with Prettier
	npm run format

format-check: node_modules ## Check formatting (no writes)
	npm run format:check

test: node_modules ## Run unit tests once
	npm test

test-watch: node_modules ## Run tests in watch mode
	npx vitest

check: typecheck worker-check lint format-check test ## Typecheck, lint, format check, tests (what CI runs)

assets: node_modules ## Re-download MediaPipe runtime + pose models into public/
	npm run fetch-assets

convert: ## Re-encode VIDEO=path/to.MOV to a Chrome-friendly H.264 .mp4 next to it (needs ffmpeg)
	@test -n "$(VIDEO)" || { echo "usage: make convert VIDEO=path/to/file.MOV"; exit 1; }
	ffmpeg -y -i "$(VIDEO)" -c:v libx264 -crf 18 -pix_fmt yuv420p -g 15 -an -movflags +faststart "$(basename $(VIDEO)).mp4"

clean: ## Remove build output
	rm -rf dist *.tsbuildinfo

distclean: clean ## Also remove node_modules and downloaded assets
	rm -rf node_modules public/mediapipe public/models

worker-check: node_modules ## Typecheck the review Worker (worker/)
	cd worker && npx tsc -p .

worker-dev: node_modules ## Run the review Worker locally on :8799 (needs worker/.dev.vars with INGEST_TOKEN and REVIEW_TOKEN)
	cd worker && npx wrangler d1 execute trampovision-review --local --file=schema.sql && npx wrangler dev --local --port 8799

worker-deploy: node_modules ## Deploy the review Worker (after wrangler d1 create, and wrangler secret put INGEST_TOKEN / REVIEW_TOKEN)
	cd worker && npx wrangler d1 execute trampovision-review --remote --file=schema.sql && npx wrangler deploy
