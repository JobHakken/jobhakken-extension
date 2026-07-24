# Threat model — JobHakken extension

The extension runs untrusted-page code (content script), talks to the desktop app over a localhost
bridge, and handles résumé/job data. This maps the attack surface and the mitigations, so security
fixes (e.g. #1, #2) are designed against a written model.

## Assets

- The user's résumé/profile data (used for autofill) and job data.
- The desktop **bridge bearer token** (authenticates the extension ↔ desktop app).

## Surfaces & mitigations

### 1. Content script ↔ page DOM (untrusted input)

Content scripts run on job-board / ATS pages we don't control. The page DOM, its text, and any
value read from it are **untrusted**.

- Never `innerHTML` untrusted strings; build DOM nodes / set `textContent`. Escape any value derived
  from résumé/page before inserting into markup (see finding #3 nits).
- Selectors built from page-controlled attributes must be `CSS.escape`d.
- CSP (`script-src 'self'`) blocks injected/remote script on extension pages.

### 2. Runtime messaging (`chrome.runtime` / `chrome.tabs`)

Messages between content script, service worker, and pages.

- No `externally_connectable` is declared → web pages cannot message the extension directly.
- Validate message `type` and shape before acting; treat sender frames as untrusted.

### 3. Localhost desktop bridge (`src/lib/bridgeClient.ts`)

The extension discovers and talks to the desktop app on `127.0.0.1`.

- **Open finding #1:** discovery currently trusts any localhost server that echoes
  `{name:'jobhakken'}`, then sends it the bearer token + content → a rogue local process could
  impersonate the app. Fix: authenticate the handshake (challenge/nonce or a pre-shared token
  check) before sending anything sensitive.
- **Open finding #2:** `content_scripts` match `*://localhost/*` + `*://127.0.0.1/*` on all
  paths/ports, injecting the copilot into every local web app. Fix: narrow to the bridge's
  origin/port (or drop localhost content-script matches entirely if the bridge is reached from the
  service worker).

### 4. Permissions surface (`manifest.json`)

Least-privilege: only `storage` + `unlimitedStorage`; host permissions limited to the localhost
bridge. **Permission creep** is guarded by `scripts/check-permissions.mjs` against
`.github/permissions-baseline.json` (CI fails on an un-baselined change; `manifest.json` is
CODEOWNERS-gated).

### 5. Supply chain / no remote code

`@jobhakken/*` are **bundled at build time** by esbuild; nothing is fetched or `eval`'d at runtime.
The build asserts the CSP never weakens `script-src` (no `unsafe-eval`/`unsafe-inline`/remote).
Dependencies are pinned exact; dependabot proposes only security + minor/patch bumps.

## Privacy invariant

User content never leaves the browser to our servers — the extension exchanges data with the local
desktop app over the bridge only. Any change to that must be called out in the PR and reviewed.
