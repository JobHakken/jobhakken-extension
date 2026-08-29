# Chrome Web Store listing (source of truth)

Paste these into the CWS Developer Dashboard. **Version-controlled so the listing is reviewed like
code and stays honest against the manifest.** Keep in sync with `src/manifest.json`.

## ⚠️ Rules that came from a rejection or a near-miss — don't relitigate these

1. **No ATS/job-board brand names in marketing copy** (Routing ID FZSL, "Keyword Spam", 2026-07).
   Describe capability generically ("major job boards and 40+ applicant tracking systems"). The
   `content_scripts.matches` list in the manifest is the technical source of supported sites, not
   marketing copy.
2. **Never claim "sends no user content off the device."** False since AI features shipped — the
   manifest declares AI provider hosts, and cover-letter/answer drafting sends page text to whichever
   one the user picked. Say what's true: content leaves the device **only** for an opt-in AI request.
3. **List of hosts/permissions in this doc must match the manifest exactly**, every release. A
   reviewer diffs them; an undisclosed host is a removal risk, not a warning.
4. **Filtering is triage, not a second feature.** Job/post filtering is framed as narrowing the list
   _before_ applying — part of the single purpose. It must stay scoped to search-results pages; if it
   ever touches the LinkedIn home feed, this framing (and the CWS single-purpose approval) breaks.

---

## Single purpose (required)

> JobHakken helps the user apply for jobs — narrowing down which roles are worth applying to, then
> filling in the application. On a search-results page it lets the user hide listings they don't want
> (by company, keyword, or a state the site shows — promoted, viewed, applied) and flags employers with
> public visa-sponsorship records. On an application form on a supported job board or ATS, it identifies
> fields and fills them from the profile the user built in Settings, and can draft an answer or cover
> letter on request. The user reviews every field; the extension never submits anything.

## Title

`JobHakken — Apply Copilot`

## Short description (≤132 chars — must match `manifest.json` `description`)

`🚀 Autofill applications, match your résumé, spot visa sponsors, and build a tailored résumé — free & local.`

## Detailed description

> No ATS/job-board brand names (rule #1 above). Plain text — emoji/dividers render as-is.

```
🚀 JobHakken — Apply Copilot
Find the roles worth your time. Fill the form in one click. Skip the ones that won't sponsor you.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 TRIAGE FIRST
🧹 Hide listings you don't want — by company, keyword, or promoted/viewed/applied
🛂 See H-1B (US) and licensed-sponsor (UK) status right on the listing, before you apply
📊 Résumé-to-job match score — real keyword gaps, not a made-up ATS number

⚡ THEN FILL, ONE CLICK
🖱️ Autofill across major job boards + 40 applicant tracking systems
🧩 Handles what others miss — custom dropdowns, comboboxes, date pickers, multi-step wizards
✅ Every field marked by confidence; unsure answers left blank, never guessed
🚫 Never auto-submits — you always review first

📄 BUILD & TAILOR YOUR RÉSUMÉ
✍️ Free built-in résumé builder — no separate app, no account
🎯 Reorders and rewrites your real experience per posting, never invents
💌 Cover letter drafted in seconds

📌 TRACK YOUR SEARCH
➡️ Optionally save roles to the free JobHakken desktop app

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 PRIVATE BY DEFAULT
🏠 Your résumé, profile, and filter rules live on your device — never our servers
🤖 AI is opt-in — bring your own key or a managed plan. Only the text an AI feature needs is ever sent
📉 Analytics are anonymous, opt-out, metadata-only — never your content
🔕 Sensitive EEO fields (gender, race, veteran, disability) are off until you turn them on
🚫 Never sold, never used to train models

✉️ contact@jobhakken.com
```

---

## Permission justifications (CWS "Privacy practices" → per-permission)

Manifest ground truth: `permissions: storage, unlimitedStorage, activeTab, scripting` · `host_permissions:
127.0.0.1, localhost, app.jobhakken.com, 12 AI provider APIs, www.google-analytics.com` — check this list
against `src/manifest.json` every release; add a row here for anything new before submitting.

| Permission                                                                                                                                               | Justification                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                                                                                                                | Save the user's application profile, settings, and filter rules locally in the browser.                                                                                                                         |
| `unlimitedStorage`                                                                                                                                       | Cache the bundled H-1B sponsor dataset and locally saved form-structure snapshots (scripts/styles/images stripped, values redacted) without hitting the default quota.                                          |
| `activeTab`                                                                                                                                              | Act on the tab the user just clicked the toolbar button or on-page control on — fill its form, or apply the user's filter rules to its listings. Never runs without that click.                                 |
| `scripting`                                                                                                                                              | Fill custom dropdown/date-picker components (several ATS platforms) that ignore ordinary programmatic input. Runs only bundled code, never fetched — only on pages the user is applying on.                     |
| `host_permissions`: `http://127.0.0.1/*`, `http://localhost/*`                                                                                           | Communicate with the user's own, optional JobHakken desktop app over the local loopback bridge (résumé tailoring, job tracking).                                                                                |
| `host_permissions`: `https://app.jobhakken.com/*`                                                                                                        | Account sign-in and subscription status for users on a managed plan.                                                                                                                                            |
| `host_permissions`: 12 AI provider APIs (Anthropic, OpenAI, OpenRouter, Google, Groq, Mistral, DeepSeek, Perplexity, Together, xAI, Fireworks, BigModel) | Only for opt-in AI features the user explicitly triggers (cover letter, answer drafting). User picks the provider and supplies their own key, or uses a managed plan. Only the text that request needs is sent. |
| `host_permissions`: `https://www.google-analytics.com/*`                                                                                                 | Anonymous, opt-out, metadata-only usage analytics (feature used, success/fail, version) — never content.                                                                                                        |
| Content scripts (job-board / ATS hosts, all frames)                                                                                                      | Detect job postings and application forms and fill them; all-frames because Workday/iCIMS and others render forms inside iframes.                                                                               |

## Data use disclosure (CWS "Privacy practices" → data collected)

- **Personally identifiable information**: YES — the profile the user enters, and (only for an opt-in
  AI request) the text that request needs, sent to the provider the user chose.
- **Website content**: YES — the extension reads the form/listings on the page. Leaves the device
  **only** for an opt-in AI request, and only the text that request needs. Never for analytics.
- **Not sold to third parties.** **Not used for purposes unrelated to core functionality.** **Not used
  for creditworthiness or lending.**
- Do **not** resurrect "sends no user content off the device" (rule #2 above) — false once AI is used.

## Remote code

`No, I am not using remote code.` AI providers and analytics are plain data requests, not loaded/executed
script; the extension's CSP forbids remote code.

## Privacy policy

`https://jobhakken.com/privacy-policy/` — must disclose (1) the optional analytics and (2) that opt-in
AI features send request text to the user's chosen provider. A reviewer who finds 12 AI host permissions
and a privacy policy silent on AI will flag the listing.

## Versioning

Keep this file, `manifest.json` `description`, and `package.json`/`manifest.json` `version` in sync.
Update this file in the same PR as any user-facing listing, permission, or host change.

---

## Publishing (Chrome Web Store API — automated)

`.github/workflows/publish.yml` auto-deploys on an `ext-vX.Y.Z` tag: it builds the production zip and
uploads + publishes via the Web Store API. To enable it, add these repo secrets once:

| Secret                               | How to get it                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | Google Cloud Console → enable **Chrome Web Store API** → **Credentials → OAuth client ID** (Desktop app).                                                                                                     |
| `CWS_REFRESH_TOKEN`                  | One-time OAuth with scope `https://www.googleapis.com/auth/chromewebstore` — easiest via `npx chrome-webstore-upload-keys`. Add yourself as a Test user (or publish the consent screen) so it doesn't expire. |
| `CWS_EXTENSION_ID`                   | `lochgcghpahlooibepjlmmcdjgicncil`                                                                                                                                                                            |

Then release with:

```bash
# bump version in package.json AND manifest.json (build asserts they match), update CHANGELOG.md, then:
git tag ext-v0.41.3 && git push origin ext-v0.41.3
```

The tag push runs the publish job. `workflow_dispatch` with `publish:false` uploads a **draft** only
(no publish) for a dry run. This repo currently publishes **manually** via the dashboard (see
`plans-and-thoughts/extension/manual-publish-guide.md` — not committed here) until the CWS API secrets
above are added; treat this section as the target-state workflow, not the current one.
