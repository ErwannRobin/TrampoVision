.DEFAULT_GOAL := help
.PHONY: help install dev build preview typecheck lint format format-check test test-watch check assets clean distclean

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

check: typecheck lint format-check test ## Typecheck, lint, format check, tests (what CI runs)

assets: node_modules ## Re-download MediaPipe runtime + pose models into public/
	npm run fetch-assets

clean: ## Remove build output
	rm -rf dist *.tsbuildinfo

distclean: clean ## Also remove node_modules and downloaded assets
	rm -rf node_modules public/mediapipe public/models
