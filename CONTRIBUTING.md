# Contributing to ApolloCut

Thanks for even opening this file — that's already contributing.

## Ways to help, no code required
- Open an **issue** when something breaks, confuses, or just feels off. Screenshots of the timeline make bugs 10× easier to fix.
- Test the **latest release** on your machine and report performance.
- Improve wording/docs/translations.

## Code
1. Fork, branch from `main`, keep commits small.
2. Keep the same style: plain ES modules, no build step, no framework, semicolons, single quotes.
3. Validate before a PR: `for f in renderer/js/*.js main/*.js; do node --check $f; done` must pass.
4. Open the PR with a short "why" — we'll review fast.

## Principles
- **Offline-first.** No telemetry, no accounts, no phone-home code will ever be merged.
- **Free means free.** No freemium paywalls inside the codebase; the license is MIT, full stop.
- **Small dependencies.** Every new npm dependency must justify itself in the PR description.

See you in the issues tab. ⚖️
