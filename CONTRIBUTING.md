# Contributing

Thanks for looking. Issues and pull requests are welcome.

## Setup

```sh
nvm use          # Node version in .nvmrc
npm install      # also downloads the pose models into public/ (scripts/fetch-assets.mjs)
npm run dev
```

## Before a pull request

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
```

CI runs the same checks (`.github/workflows/ci.yml`).

## Guidelines

- Keep the app local-only by default: the video never leaves the browser, and `src/localOnlyGuard.ts` plus the CSP block cross-origin requests. Any feature that sends data somewhere must be opt-in and documented in the README.
- Every number shown must stay explainable: thresholds live in `src/skills/config.ts` and `src/coaching/config.ts`, not inline.
- User-facing text goes through `src/i18n/` in all four languages (English, French, German, Japanese).
- Do not commit videos of people, saved analyses of real athletes, or secrets. `video-sample/` and `eval/` are git-ignored on purpose.
- Say in the pull request what you checked, and what you did not.

## Reporting a security problem

Do not open a public issue. Use GitHub's "Report a vulnerability" on the Security tab of the repository.
