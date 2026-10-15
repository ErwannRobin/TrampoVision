.DEFAULT_GOAL := help

# Every target with a `##` description is phony (node_modules is the one real file target).
.PHONY: $(shell grep -hoE '^[a-zA-Z0-9_-]+:.*\#\#' $(MAKEFILE_LIST) | cut -d: -f1)

# $(call require,VAR,usage line): stop with the usage line when VAR is empty. Keep commas out of the usage line.
require = @test -n "$($(1))" || { echo 'usage: $(2)'; exit 1; }

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

##@ Develop

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

clean: ## Remove build output
	rm -rf dist *.tsbuildinfo

distclean: clean ## Also remove node_modules and downloaded assets
	rm -rf node_modules public/mediapipe public/models

##@ Check

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

check: typecheck worker-check lint format-check test ## Typecheck, lint, format check, tests

ci: check build ## Everything CI runs

##@ Assets (the Blob asset host reads BLOB_READ_WRITE_TOKEN, .env.local or .env)

assets-download: node_modules ## Re-download MediaPipe runtime + pose models into public/
	npm run fetch-assets

assets-upload: node_modules ## Upload models, wasm, samples: [SAMPLES=dir] [FORCE=1] [DRY_RUN=1]
	npm run assets-upload -- $(if $(SAMPLES),--samples $(SAMPLES)) $(if $(DRY_RUN),--dry-run) $(if $(FORCE),--force)

assets-precompute: node_modules ## Analyze sample videos so the app skips the pose model: [SAMPLES=dir] [FORCE=1]
	@test -d node_modules/playwright-core || npm i --no-save playwright-core
	npm run precompute-samples -- $(if $(SAMPLES),--samples $(SAMPLES)) $(if $(FORCE),--force)

asset-remove: node_modules ## Delete from the host: make asset-remove NAME... [DRY_RUN=1]
	$(call require,ASSET_NAMES,make asset-remove synchro.mp4 [other ...] [DRY_RUN=1]  (a store path or a sample name; a name without extension removes the clip: .mp4 .MOV .pose.json))
	npm run asset-remove -- $(ASSET_NAMES) $(if $(DRY_RUN),--dry-run)

assets-remove: node_modules ## Delete a kind after a confirmation: [WHAT=videos|samples|models|wasm|all] [YES=1] [DRY_RUN=1]
	npm run assets-remove -- $(WHAT) $(if $(YES),--yes) $(if $(DRY_RUN),--dry-run)

# `make asset-remove synchro.mp4`: the other words of the command line are the names, not targets
ifneq ($(filter asset-remove,$(MAKECMDGOALS)),)
ASSET_NAMES := $(filter-out asset-remove,$(MAKECMDGOALS))
$(ASSET_NAMES):
	@:
endif

icons: node_modules ## Re-render the home-screen icons in public/ from the logo
	node scripts/icons.mjs

video-convert: ## Re-encode VIDEO=path/to.MOV to a Chrome-friendly H.264 .mp4 (needs ffmpeg)
	$(call require,VIDEO,make video-convert VIDEO=path/to/file.MOV)
	ffmpeg -y -i "$(VIDEO)" -c:v libx264 -crf 18 -pix_fmt yuv420p -g 15 -an -movflags +faststart "$(basename $(VIDEO)).mp4"

##@ Classifier evaluation

eval-fetch: ## Download the reviewed jumps to eval/export.ndjson (REVIEW_API_URL, REVIEW_TOKEN)
	$(call require,REVIEW_API_URL,set REVIEW_API_URL and REVIEW_TOKEN)
	$(call require,REVIEW_TOKEN,set REVIEW_API_URL and REVIEW_TOKEN)
	@mkdir -p eval
	@printf 'authorization: Bearer %s' "$$REVIEW_TOKEN" | curl -sf -H @- "$(REVIEW_API_URL)/export" -o eval/export.ndjson
	@wc -l eval/export.ndjson

eval-run: node_modules ## Score the classifier on reviewed jumps: FILE= [LABELS=dir] [BASELINE=f | SAVE=f]
	$(call require,FILE,make eval-run FILE=eval/export.ndjson [LABELS=eval/labels] [BASELINE=f.json | SAVE=f.json]  (get the file with: make eval-fetch))
	npx vite-node scripts/eval.ts $(FILE) $(if $(LABELS),--labels $(LABELS)) $(if $(BASELINE),--baseline $(BASELINE)) $(if $(SAVE),--save $(SAVE))

eval-consistency: node_modules ## Label-free rotation quality of jumps or a pose series: FILE= [BASELINE=f | SAVE=f]
	$(call require,FILE,make eval-consistency FILE=<dataset.json | export.ndjson | pose-series.json> [BASELINE=f.json | SAVE=f.json])
	npx vite-node scripts/consistency.ts $(FILE) $(if $(BASELINE),--baseline $(BASELINE)) $(if $(SAVE),--save $(SAVE))

eval-fusion: node_modules ## Replay the pose check and the merge of two saved analyses of one clip: FIRST= SECOND= [ALL=1]
	$(call require,FIRST,make eval-fusion FIRST=mediapipe.json SECOND=rtmpose.json [ALL=1])
	$(call require,SECOND,make eval-fusion FIRST=mediapipe.json SECOND=rtmpose.json [ALL=1])
	npx vite-node scripts/fusion-eval.ts $(FIRST) $(SECOND) $(if $(ALL),--all)

eval-label-sheet: node_modules ## Labeling sheet, blank labels, filmstrip commands: FILE= [VIDEO=clip] [STRIPS=1]
	$(call require,FILE,make eval-label-sheet FILE=eval/x.dataset.json [VIDEO=clip.mp4] [STRIPS=1])
	npx vite-node scripts/label-sheet.ts $(FILE) $(if $(VIDEO),--video $(VIDEO)) $(if $(STRIPS),--strips)

eval-jev: node_modules ## Compare Jev with the classifier (needs TYPESAFE_API_KEY): FILE= [DEBUG=1] [ALL=1]
	$(call require,FILE,TYPESAFE_API_KEY=... make eval-jev FILE=eval/export.ndjson [DEBUG=1] [ALL=1])
	npx vite-node scripts/jev-eval.ts $(FILE) $(if $(DEBUG),--debug) $(if $(ALL),--all)

motion-eval: node_modules ## Run the motion detector over a real clip (needs ffmpeg): FILE= [SHEET=boxes.png] [EVERY=3] [CONFIG=json]
	$(call require,FILE,make motion-eval FILE=clip.mp4 [SHEET=boxes.png] [EVERY=3] [CONFIG=json])
	npx vite-node scripts/motion-eval.ts $(FILE) $(if $(SHEET),--sheet $(SHEET)) $(if $(EVERY),--every $(EVERY)) $(if $(CONFIG),--config '$(CONFIG)')

pose-eval: node_modules ## Check the choice of the jumper on a real clip (needs Chrome, ffmpeg): FILE= [MASKED=1] [ZOOM=1] [GPU=1] [FOCUSED=1] [NOLOOKS=1] [SHEET=chosen.png] [EVERY=3] [RATE=15] [POSES=5] [ATHLETES=1] [CACHE=f.json] [MAX=s]
	$(call require,FILE,make pose-eval FILE=clip.mp4 [MASKED=1] [ZOOM=1] [GPU=1] [FOCUSED=1] [NOLOOKS=1] [SHEET=chosen.png] [EVERY=3] [RATE=15] [POSES=5] [ATHLETES=1] [CACHE=f.json] [MAX=s])
	@test -d node_modules/playwright-core || npm i --no-save playwright-core
	npx vite-node scripts/pose-eval.ts $(FILE) $(if $(MASKED),--masked) $(if $(ZOOM),--zoom) $(if $(GPU),--gpu) $(if $(FOCUSED),--focused) $(if $(NOLOOKS),--no-looks) $(if $(SHEET),--sheet $(SHEET)) $(if $(EVERY),--every $(EVERY)) $(if $(RATE),--rate $(RATE)) $(if $(POSES),--poses $(POSES)) $(if $(ATHLETES),--athletes $(ATHLETES)) $(if $(CACHE),--cache $(CACHE)) $(if $(MAX),--max $(MAX))

##@ Review Worker

worker-check: node_modules ## Typecheck the Worker (worker/)
	cd worker && npx tsc -p .

worker-dev: node_modules ## Run it locally on :8799 (needs worker/.dev.vars)
	cd worker && npx wrangler d1 execute trampovision-review --local --file=schema.sql && npx wrangler dev --local --port 8799

worker-schema: node_modules ## Apply worker/schema.sql to the remote D1 database
	cd worker && npx wrangler d1 execute trampovision-review --remote --file=schema.sql

worker-deploy: node_modules ## Deploy it (worker-schema first when schema.sql changed)
	cd worker && npx wrangler deploy

worker-r2: node_modules ## Create the R2 bucket of the shared clips (EU) with its 90-day expiry, once, before the first deploy
	cd worker && npx wrangler r2 bucket create trampovision-shares --jurisdiction eu
	cd worker && npx wrangler r2 bucket lifecycle add trampovision-shares expire-shares --expire-days 90 --jurisdiction eu --force
