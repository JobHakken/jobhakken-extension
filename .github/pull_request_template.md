<!-- Keep PRs focused and phase-scoped. See CONTRIBUTING.md. -->

## What & why

<!-- What does this change and why? Link the issue: Closes #123 -->

## How verified

<!-- Exact commands / manual flow. Paste `npm run verify` output; load-unpacked check for UI. -->

## Checklist (Definition of Done)

- [ ] `npm run verify` is green (typecheck + lint + build + test)
- [ ] `package.json` and `manifest.json` versions still in sync; `CHANGELOG.md` updated if user-facing
- [ ] No change to `permissions` / `host_permissions` / `content_scripts.matches` (or it's called out + justified)
- [ ] No secrets; no new `any`; no remote code introduced
- [ ] Focused branch, atomic commits, Conventional Commit titles
