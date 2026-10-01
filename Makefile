.DEFAULT_GOAL := help
.PHONY: icons eval jev-eval eval-fetch worker-schema worker-dev worker-check worker-deploy help install dev build preview typecheck lint format format-check test test-watch check assets upload-assets convert clean distclean

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

upload-assets: node_modules ## Upload models, wasm and samples to the Blob asset host: [SAMPLES=dir] [DRY_RUN=1] (needs BLOB_READ_WRITE_TOKEN unless DRY_RUN)
	@test -n "$(DRY_RUN)" -o -n "$$BLOB_READ_WRITE_TOKEN" || { echo "set BLOB_READ_WRITE_TOKEN (or use DRY_RUN=1 to only list the files)"; exit 1; }
	npm run upload-assets -- $(if $(SAMPLES),--samples $(SAMPLES)) $(if $(DRY_RUN),--dry-run)

icons: node_modules ## Re-render the home-screen icons in public/ from the logo
	node scripts/icons.mjs

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

worker-deploy: node_modules ## Deploy the review Worker (run worker-schema first, and only when schema.sql changes; needs d1 create + wrangler secret put INGEST_TOKEN / REVIEW_TOKEN)
	cd worker && npx wrangler deploy

eval: node_modules ## Score the classifier on reviewed jumps: FILE=eval/export.ndjson [BASELINE=eval/baseline.json | SAVE=eval/baseline.json]
	@test -n "$(FILE)" || { echo "usage: make eval FILE=eval/export.ndjson [BASELINE=f.json | SAVE=f.json]  (get the file with: make eval-fetch)"; exit 1; }
	npx vite-node scripts/eval.ts $(FILE) $(if $(BASELINE),--baseline $(BASELINE)) $(if $(SAVE),--save $(SAVE))

jev-eval: node_modules ## Compare Jev with the classifier on reviewed jumps: FILE=eval/export.ndjson [DEBUG=1] (needs TYPESAFE_API_KEY; only measurements are sent)
	@test -n "$(FILE)" || { echo "usage: TYPESAFE_API_KEY=... make jev-eval FILE=eval/export.ndjson [DEBUG=1]"; exit 1; }
	npx vite-node scripts/jev-eval.ts $(FILE) $(if $(DEBUG),--debug)

eval-fetch: ## Download the reviewed jumps to eval/export.ndjson (needs REVIEW_API_URL and REVIEW_TOKEN in the environment)
	@test -n "$(REVIEW_API_URL)" -a -n "$(REVIEW_TOKEN)" || { echo "set REVIEW_API_URL and REVIEW_TOKEN"; exit 1; }
	@mkdir -p eval
	curl -sf -H "authorization: Bearer $(REVIEW_TOKEN)" "$(REVIEW_API_URL)/export" -o eval/export.ndjson
	@wc -l eval/export.ndjson

worker-schema: node_modules ## Apply worker/schema.sql to the remote D1 database (no deploy)
	cd worker && npx wrangler d1 execute trampovision-review --remote --file=schema.sql
