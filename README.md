# JobHakken — Apply Copilot (Chrome Extension)

The JobHakken browser extension: catches new roles as you browse job boards and autofills
applications, working alongside the [JobHakken desktop app](https://jobhakken.com).

**Live:** [Chrome Web Store — JobHakken · Apply Copilot](https://chromewebstore.google.com/detail/jobhakken-%E2%80%94-apply-copilot/lochgcghpahlooibepjlmmcdjgicncil)

> **Proprietary & confidential** — see [`LICENSE`](LICENSE). Not open source.

## Repo layout

This is a standalone MV3 extension. It was split out of the JobHakken monorepo with full history.
It shares two libraries with the desktop app, consumed from **GitHub Packages** (private):

- `@jobhakken/core` — framework-agnostic domain logic
- `@jobhakken/autofill` — form-detection / autofill engine

esbuild **bundles** these at build time (they are not runtime deps of the shipped extension).

## Prerequisites

- **Node 22** (`.nvmrc`)
- A GitHub token with **`read:packages`** to install the `@jobhakken/*` packages. Export it as
  `NODE_AUTH_TOKEN` (`.npmrc` is already configured to use it). In CI, `GITHUB_TOKEN` covers this.

## Develop

```bash
export NODE_AUTH_TOKEN=<your GitHub token with read:packages>
npm install
npm run build          # bundles to dist/ (load unpacked)
```

Then load `dist/` as an unpacked extension at `chrome://extensions` (Developer mode → Load unpacked).

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
