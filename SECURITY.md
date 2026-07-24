# Security Policy

The JobHakken extension handles résumé/job data and talks to the desktop app over a localhost
bridge, so we take security seriously.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

- Preferred: open a private advisory at
  https://github.com/JobHakken/JobHakken/security/advisories/new
- Or email **security@jobhakken.com**.

Please include reproduction steps and impact. We aim to acknowledge within 3 business days.
(User-facing, non-security bugs go to the public tracker: https://github.com/JobHakken/JobHakken-issues)

## Extension-specific notes

- **Permissions are least-privilege.** `manifest.json` requests only `storage` + `unlimitedStorage`;
  host permissions are limited to the desktop bridge on localhost. Any change to `permissions`,
  `host_permissions`, or `content_scripts.matches` must be called out in the PR and maintainer-reviewed.
- **No remote code.** `@jobhakken/*` are bundled at build time; nothing is fetched/eval'd at runtime.
- **Never commit secrets.** The Chrome Web Store publish credentials live in repo secrets, never in code.

## Privacy model

User job/résumé **content never leaves the browser to our servers** — the extension exchanges data
with the local desktop app over the bridge. Only usage **metadata** may be reported. Any change that
would send user content off-device must be called out in the PR and reviewed by a maintainer.
