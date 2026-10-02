# TrampoVision

## Code style

- Formatting is Prettier (`.prettierrc.json`), linting is oxlint. CI runs `make check` and fails on any formatting drift.
- A project hook in `.claude/settings.json` runs Prettier on every file you edit or write. Do not hand-format.
- Before committing or opening a PR, run `make check` (typecheck, lint, format check, tests). If `format:check` fails, run `npm run format` and commit the result in the same commit, not as a separate "fix code style" commit.
- Generated or bulk-edited files (for example `docs/architecture.html`) are not covered by the per-edit hook when written through Bash. Run `npm run format` after such changes.
