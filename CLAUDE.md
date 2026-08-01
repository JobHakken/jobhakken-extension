# CLAUDE.md — jobhakken-extension

Guidance for Claude Code (and humans) working in this repo. These are project rules; follow them.
_Created 2026-07-24._

## What this is

The **JobHakken "Apply Copilot" Chrome extension** (Manifest V3). It catches roles as you browse job
boards and autofills applications, working alongside the desktop app. Split out of the monorepo
(`JobHakken/JobHakken`) with full history; it is **standalone** — it builds from a fresh clone with no
`extends` into monorepo configs and no `workspace:*` deps.

Shared logic is consumed from **GitHub Packages** (private): `@jobhakken/core` (domain logic) and
`@jobhakken/autofill` (form detection/fill). esbuild **bundles** these at build time — they are not
runtime deps of the shipped extension, and nothing is ever fetched at runtime.

Live: [Chrome Web Store](https://chromewebstore.google.com/detail/jobhakken-%E2%80%94-apply-copilot/lochgcghpahlooibepjlmmcdjgicncil).
**Proprietary & confidential** (see `LICENSE`).

## Layout

- `src/content/` — content script (runs on job-board / ATS pages; treats page DOM as **untrusted**).
- `src/background/` — MV3 service worker (module).
- `src/lib/` — stores + the **localhost bridge client** (talks to the desktop app on `127.0.0.1`).
- `src/options/`, `src/popup/` — extension pages (plain TS + HTML).
- `src/manifest.json` — MV3 manifest (permissions: `storage`, `unlimitedStorage` only).
- `build.mjs` (esbuild) → `dist/`; `e2e/` (Playwright, real Chromium); `scripts/gen-h1b-data.mjs`.

## Privacy model (same promise as the app — see the app's ADR-0003 local-always)

- **No user content leaves the browser to our servers.** The extension talks to the **desktop app over
  a localhost bridge**; résumé/job data stays local. Any telemetry is **metadata only**, never content
  (opt-out; mirrors app issue #233).
- The **Chrome Web Store listing disclosure must match this exactly** — single-purpose + per-permission
  justification + honest data-use statement (tracked in the standards epic #11 / Phase 6).
- Treat the page DOM and any inbound `runtime` message as untrusted input; validate before use.

## Workflow

- **Issue-first.** File an issue before working.
  - Internal / engineering / **security** findings → **this private repo** (`JobHakken/jobhakken-extension`).
  - **User-facing** bug reports & feature requests → the public **`JobHakken/JobHakken-issues`** tracker
    (the in-repo issue-template config already redirects there). Never put security specifics there.
- **SemVer**, tagged `ext-vX.Y.Z`; **keep `package.json` and `manifest.json` versions in sync** and add
  a `CHANGELOG.md` entry for every user-facing change.
- Security issues → a **private advisory**, never a public issue.

### Git development pipeline (follow every time)

`develop` is the **integration branch**; `main` is the **stable/release branch**. Feature/phase
branches come off `develop` and PR back into `develop`; `develop` is promoted to `main` at green
milestones. One feature per branch, verified locally, merged via PR. Never commit straight to
`develop`/`main`; never delete branches without explicit permission.

```bash
# 1. Branch off the latest develop (each feature/phase gets its own branch)
git checkout develop && git pull
git checkout -b <type>/<short-topic>        # e.g. standards/phase-7-safeguards

# 2. Do the work as atomic Conventional Commits (husky enforces the message + pre-commit lint/format)

# 3. Verify locally — this is the merge gate (CI is minimized)
export NODE_AUTH_TOKEN=<GitHub token with read:packages>   # to install @jobhakken/*
npm ci
npm run verify            # typecheck + lint + build + test (the exact CI job)
npm run ci:local          # optional: run the real GitHub Actions in a container via act

# 4. Push (pre-push re-runs verify) and open a PR into develop
git push -u origin <branch>
gh pr create --base develop --fill

# 5. Merge the PR once green (do NOT --delete-branch)
gh pr merge <n> --merge

# 6. Next feature starts again from an updated develop (step 1) — don't stack branches

# Promote to main at a green milestone (dependabot reads its config from main, the default branch):
#   gh pr create --base main --head develop --fill && gh pr merge develop --merge
```

CI is minimized: it runs typecheck+build+test+lint on PR / `main` push; e2e is gated to `ext-v*`
tags + dispatch. So the **local `npm run verify` (and `npm run ci:local` for container fidelity) is
the real gate** — green locally before you merge.

## Build / dev

- Node 22 (`.nvmrc`). Installing `@jobhakken/*` needs a GitHub token with **`read:packages`** as
  `NODE_AUTH_TOKEN` (`.npmrc` reads it; CI uses `GITHUB_TOKEN`).
- `npm run build` → `dist/` (load unpacked at `chrome://extensions`). `npm run package` → store zip.
- `npm run test:e2e` builds + drives the extension in real Chromium against local ATS fixtures + a mock
  bridge. `npm run gen:h1b -- <csv>` regenerates the sponsor list.

### Robustness testing (dev loop — all local, no CI; see `plans-and-thoughts/ideas/robustness-approach.md`)

- `npm run smoke` — the **honest coverage gate**: golden tests (`e2e/goldens/*.golden.json`) assert the
  right value lands in the right field (precision/recall), core PII gated. **Run after any
  `@jobhakken/autofill` bump.**
- `npm run test:live` (alias `npm run canary`) — **discovery/drift**: drive the extension against real
  public ATS pages in Demo mode (dummy data, fill-only, never submit); reports per-site coverage + flags
  fixture candidates. Edit `e2e/live/targets.json` first. Non-gating (URLs rot).
- `npm run capture:har -- ` (env `CAPTURE_URL`/`CAPTURE_NAME`) — freeze a SPA/gated page into a replayable
  HAR (`e2e/har/`); `e2e/replay.spec.ts` then replays it offline in the gate. Private repo, minimise captures.
- Dev-only correction signal (`src/lib/correctionSignal.ts`) ranks the fields autofill keeps missing —
  gated behind a dev flag **and** Demo mode; never runs for a real user.

## Standards status

This repo is **mid-hardening** — see epic **#11**. Not yet in place (do not assume they exist): ESLint,
Prettier, EditorConfig, git hooks (husky/commitlint), a committed lockfile, `@types/chrome`, CODEOWNERS/
CONTRIBUTING/SECURITY, dependabot, permission-diff guard, automated CWS publish. When you touch a file,
fold in any relevant open finding (#1 bridge trust, #2 localhost content-script scope, #3 nits) and
reference it in the commit.

## Cross-surface coordination (app · extension · website)

Three surfaces, three agents, three chats — **agents don't share memory** (see monorepo ADR-0007).
Sync lives in the repos, not the chats:

- **Start each session:** `git pull`; read this file; check the monorepo `COORDINATION.md` + issues
  here labeled `needs:extension` / `cross-surface`.
- **End each session:** anything another surface must know → **file an issue in the right repo** (route
  with `needs:app|backend|extension|web` + `cross-surface`; put the interface contract IN the issue) ·
  a shared decision → an **ADR** in `JobHakken/JobHakken` `docs/decisions/` · a data-shape change →
  **bump `@jobhakken/core`**. Never leave cross-surface state only in the chat.
- Live board + contracts: `JobHakken/JobHakken` → `COORDINATION.md`.
- Open extension↔other-surface items: **#1** (bridge handshake ← app #283), **#43/#278** (telemetry
  first-party sink ← backend #278), résumé `schemaVersion` validation (ADR-0005).

## Pointers

- Onboarding & commands: `README.md` · Changelog: `CHANGELOG.md`
- Shared libs live in `JobHakken/JobHakken` (`libraries/core`, `libraries/autofill`) — don't fork them here.
- Cross-surface model: monorepo `docs/decisions/0007-*` + `COORDINATION.md`.
