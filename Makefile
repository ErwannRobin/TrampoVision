.DEFAULT_GOAL := help
.PHONY: icons consistency eval jev-eval eval-fetch label-sheet worker-schema worker-dev worker-check worker-deploy help install dev build preview typecheck lint format format-check test test-watch check assets assets-upload asset-remove assets-remove precompute-samples convert clean distclean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

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

assets-upload: node_modules ## Upload models, wasm and samples to the Blob asset host: [SAMPLES=dir] [DRY_RUN=1] [FORCE=1] (skips what is already there; token from BLOB_READ_WRITE_TOKEN, .env.local or .env)
	npm run assets-upload -- $(if $(SAMPLES),--samples $(SAMPLES)) $(if $(DRY_RUN),--dry-run) $(if $(FORCE),--force)

asset-remove: node_modules ## Delete files from the Blob asset host: make asset-remove NAME... [DRY_RUN=1] (a store path, or a sample name; without extension it removes the clip: .mp4, .MOV and .pose.json)
	@test -n "$(ASSET_NAMES)" || { echo 'usage: make asset-remove synchro.mp4 [other ...] [DRY_RUN=1]'; exit 1; }
	npm run asset-remove -- $(ASSET_NAMES) $(if $(DRY_RUN),--dry-run)

assets-remove: node_modules ## Delete a kind of asset from the Blob asset host, after a confirmation: [WHAT=videos|samples|models|wasm|all] [YES=1] [DRY_RUN=1] (no WHAT: asks; videos = sample videos only, samples = videos + analysis)
	npm run assets-remove -- $(WHAT) $(if $(YES),--yes) $(if $(DRY_RUN),--dry-run)

# `make asset-remove synchro.mp4`: the other words of the command line are the names, not targets
ifneq ($(filter asset-remove,$(MAKECMDGOALS)),)
ASSET_NAMES := $(filter-out asset-remove,$(MAKECMDGOALS))
$(ASSET_NAMES):
	@:
endif

precompute-samples: node_modules ## Analyze the sample videos once so the app skips the pose model: [SAMPLES=dir] [FORCE=1] (needs Google Chrome; installs playwright-core if missing)
	@test -d node_modules/playwright-core || npm i --no-save playwright-core
	npm run precompute-samples -- $(if $(SAMPLES),--samples $(SAMPLES)) $(if $(FORCE),--force)

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

eval: node_modules ## Score the classifier on reviewed jumps: FILE=eval/export.ndjson [LABELS=eval/labels] [BASELINE=eval/baseline.json | SAVE=eval/baseline.json]
	@test -n "$(FILE)" || { echo "usage: make eval FILE=eval/export.ndjson [BASELINE=f.json | SAVE=f.json]  (get the file with: make eval-fetch)"; exit 1; }
	npx vite-node scripts/eval.ts $(FILE) $(if $(LABELS),--labels $(LABELS)) $(if $(BASELINE),--baseline $(BASELINE)) $(if $(SAVE),--save $(SAVE))

label-sheet: node_modules ## Make a labeling sheet, blank label file and filmstrip commands from a dataset: FILE=eval/x.dataset.json [VIDEO=clip.mp4] [STRIPS=1 runs ffmpeg]
	@test -n "$(FILE)" || { echo "usage: make label-sheet FILE=eval/x.dataset.json [VIDEO=clip.mp4] [STRIPS=1]"; exit 1; }
	npx vite-node scripts/label-sheet.ts $(FILE) $(if $(VIDEO),--video $(VIDEO)) $(if $(STRIPS),--strips)

consistency: node_modules ## Label-free rotation quality of saved jumps or a pose series: FILE=eval/dong-dong.dataset.json [BASELINE=f.json | SAVE=f.json]
	@test -n "$(FILE)" || { echo "usage: make consistency FILE=<dataset.json | export.ndjson | pose-series.json> [BASELINE=f.json | SAVE=f.json]"; exit 1; }
	npx vite-node scripts/consistency.ts $(FILE) $(if $(BASELINE),--baseline $(BASELINE)) $(if $(SAVE),--save $(SAVE))

jev-eval: node_modules ## Compare Jev with the classifier on reviewed jumps: FILE=eval/export.ndjson [DEBUG=1] [ALL=1] (needs TYPESAFE_API_KEY; only measurements are sent)
	@test -n "$(FILE)" || { echo "usage: TYPESAFE_API_KEY=... make jev-eval FILE=eval/export.ndjson [DEBUG=1] [ALL=1]"; exit 1; }
	npx vite-node scripts/jev-eval.ts $(FILE) $(if $(DEBUG),--debug) $(if $(ALL),--all)

eval-fetch: ## Download the reviewed jumps to eval/export.ndjson (needs REVIEW_API_URL and REVIEW_TOKEN in the environment)
	@test -n "$(REVIEW_API_URL)" -a -n "$(REVIEW_TOKEN)" || { echo "set REVIEW_API_URL and REVIEW_TOKEN"; exit 1; }
	@mkdir -p eval
	curl -sf -H "authorization: Bearer $(REVIEW_TOKEN)" "$(REVIEW_API_URL)/export" -o eval/export.ndjson
	@wc -l eval/export.ndjson

worker-schema: node_modules ## Apply worker/schema.sql to the remote D1 database (no deploy)
	cd worker && npx wrangler d1 execute trampovision-review --remote --file=schema.sql
