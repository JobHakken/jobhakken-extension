# JobHakken — Apply Copilot (Chrome Extension)

The JobHakken browser extension: catches new roles as you browse job boards and autofills
applications, working alongside the [JobHakken desktop app](https://jobhakken.com).

**Live:** [Chrome Web Store — JobHakken · Apply Copilot](https://chromewebstore.google.com/detail/jobhakken-%E2%80%94-apply-copilot/lochgcghpahlooibepjlmmcdjgicncil)

> **Licensed AGPL-3.0** — see [`LICENSE`](LICENSE). Status: in transition to open source; see below
> before assuming a plain `npm install` works for you yet.

## Repo layout

This is a standalone MV3 extension. It was split out of the JobHakken monorepo with full history.

It used to share two libraries with the desktop app, both consumed from GitHub Packages (private).
That's down to one:

- **`@jobhakken/core`** — no longer a dependency. The extension's actual needs from it (a company-name
  normalizer, the sponsorship-eligibility classifier, and the BYOK LLM client stack — nothing touching
  billing or entitlements) are now vendored directly into [`src/lib/vendor/`](src/lib/vendor/), each
  file with a provenance header. `core` itself stays proprietary — it's the company's actual business
  logic (billing, sync, matching). See `JobHakken/JobHakken` ADR 0013 for the full reasoning and the
  one real tradeoff it introduces (these vendored files can now drift from `core`'s own copies without
  someone noticing — flagged there for whoever next changes either side).
- **`@jobhakken/autofill`** — still a private-registry dependency **for now**. It's been extracted to
  its own repo, [`github.com/JobHakken/autofill`](https://github.com/JobHakken/autofill) (MIT-licensed,
  zero dependencies, verified standalone) — currently private, pending a separate decision on making it
  public. Until that happens, building this repo from a fresh clone still needs org access.

esbuild **bundles** whatever's imported at build time — none of this is a runtime dependency of the
shipped extension.

## Prerequisites

- **Node 22** (`.nvmrc`)
- **For now:** a GitHub token with **`read:packages`**, to install `@jobhakken/autofill` — the one
  remaining private dependency. Export it as `NODE_AUTH_TOKEN` (`.npmrc` is already configured to use
  it). In CI, `GITHUB_TOKEN` covers this. This requirement goes away once `autofill`'s own visibility
  is resolved.

## Develop

```bash
export NODE_AUTH_TOKEN=<your GitHub token with read:packages>
npm install
npm run build          # bundles to dist/ (load unpacked)
```

Then load `dist/` as an unpacked extension at `chrome://extensions` (Developer mode → Load unpacked).

## End-to-end tests (real Chromium)

Unit tests (`npm test`, jsdom) run in CI on every push. The heavier Playwright e2e loads the
**built** extension into a real Chromium and drives it against local ATS fixtures + a mock desktop
bridge:

```bash
export NODE_AUTH_TOKEN=<token with read:packages>   # to install @jobhakken/* (once)
npx playwright install chromium                      # once
npm run test:e2e            # builds, then runs e2e/extension.spec.ts
npm run test:e2e:headed     # watch a visible browser
npm run test:e2e:ui         # Playwright time-travel UI
```

Fixtures live in [`e2e/fixtures/`](e2e/fixtures) (committed, PII-scrubbed captures). In CI this runs
on release tags (`ext-v*`) + on demand (Actions → "E2E") — not every push, to conserve minutes.

## Regenerate the H-1B sponsor list

`src/data/h1b-sponsors.txt` is generated from the backend's sponsor CSV (~7.5 MB, kept in the main
repo — not vendored here). To refresh it after the CSV changes:

```bash
npm run gen:h1b -- /path/to/h1b-sponsors.csv
# (in a monorepo checkout: apps/backend/supabase/data/h1b-sponsors.csv)
```

## Package for the Chrome Web Store

```bash
npm run package        # builds + zips → jobhakken-extension.zip (upload this)
```

Icons (16/32/48/128) are generated at build time from [`brand/favicon.svg`](brand/favicon.svg) — keep
that in sync with the website favicon (the canonical brand mark) when the brand changes.

## Versioning

SemVer, tagged `ext-vX.Y.Z` (see the product's versioning doc). Bump `version` in `package.json`
and the MV3 manifest together; add a `CHANGELOG.md` entry.

## Bugs & feedback

All bug reports and feature requests are tracked in the public
**[JobHakken-issues](https://github.com/JobHakken/JobHakken-issues)** repo (one tracker for the
desktop app + extension). Security issues → a
[private advisory](https://github.com/JobHakken/JobHakken/security/advisories/new), never a public issue.
