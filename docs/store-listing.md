# Chrome Web Store listing (source of truth)

Paste these into the CWS Developer Dashboard. **Version-controlled so the listing is reviewed like
code and the keyword-spam rejection can't recur.** Keep in sync with the manifest.

## ⚠️ Rejection remediation (Routing ID FZSL — "Keyword Spam", 2026-07)

The previous **detailed description** listed applicant-tracking-system brand names
("LinkedIn, Indeed, Workday, Greenhouse, Lever, Ashby, iCIMS, SuccessFactors, SmartRecruiters"),
which CWS flagged as excessive/irrelevant metadata. **Rule going forward: do not enumerate job-board
or ATS brand names in any store metadata (title, description, screenshots).** Describe the capability
generically ("major job boards and applicant tracking systems"). The `content_scripts.matches` list
in the manifest is the technical source of supported sites — it does not belong in marketing copy.

---

## Single purpose (required)

> JobHakken's Apply Copilot has one purpose: help a user apply to jobs faster by autofilling
> application forms and surfacing job-fit signals, working alongside the JobHakken desktop app.

## Title

`JobHakken — Apply Copilot`

## Short description (≤132 chars — matches `manifest.json` `description`)

`🚀 Autofill job applications smartly, with a job-description match, H-1B/UK visa signal, and a résumé tailored for the job.`

## Detailed description (keyword-spam-free)

> Rule: NO enumerated ATS/job-board brand names anywhere (that was the rejection cause). Describe the
> capability generically ("major job boards and 40+ applicant tracking systems"). CWS renders plain
> text — the emoji + divider lines below display as-is.

```
🚀 JobHakken — AI Job Copilot for Faster, Smarter Applications
Land more interviews, with less effort.

The privacy-first AI copilot for job seekers — especially international professionals — who want to apply faster without losing quality. Works right on the sites you already use.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ APPLY IN MINUTES, NOT HOURS
🖱️ One-click autofill — major job boards + 40+ applicant tracking systems
🧩 Handles the tricky fields other tools miss: custom dropdowns, comboboxes, date pickers

🎯 KNOW IF A JOB IS WORTH IT — BEFORE YOU APPLY
📊 Résumé Match Analysis — keyword coverage + the skills you're missing
✅ Real, practical insight — not a made-up ATS score

🌍 BUILT FOR INTERNATIONAL PROFESSIONALS
🛂 Spots US H-1B sponsoring employers and UK licensed visa sponsors, right on the posting
⏱️ Stop wasting time on roles that won't sponsor you

✍️ TAILOR EVERY APPLICATION
📄 Role-specific résumé — reorders and rewrites your real experience, never invents
💌 Personalized cover letter, drafted in seconds

📌 SAVE JOBS WITH ONE CLICK
➡️ Send roles straight to the JobHakken desktop app to organize, track, and manage your search

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 PRIVACY FIRST. ALWAYS.
🏠 Local-first — résumé & application content stay on your computer, exchanged only with the JobHakken desktop app on localhost, never uploaded to our servers
🤖 AI is 100% opt-in — bring your own key, or use a managed plan
📉 Analytics are anonymous & opt-out (feature usage, pass/fail, version) — never your résumé, job, or personal content. Toggle off anytime in Settings
🚫 We never train AI models on your data, and never sell your personal information
🔕 Sensitive EEO fields (gender, race, veteran status, disability) are off by default — you turn them on, not us

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💼 WORKS WITH THE FREE JOBHAKKEN DESKTOP APP
🗂️ Unlocks: Application Tracker · AI Résumé Studio · Job Scanner · Saved Jobs Feed · Career Workspace
⬇️ Free at jobhakken.com

✅ Apply faster   ✅ Higher-quality applications   ✅ Better job matching
✅ Visa sponsorship insights   ✅ Privacy-first by design

✉️ Questions? contact@jobhakken.com
```

---

## Permission justifications (CWS "Privacy practices" → per-permission)

| Permission                                                     | Justification                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `storage`                                                      | Save the user's autofill profile and preferences locally in the browser.                                      |
| `unlimitedStorage`                                             | Cache the bundled H-1B sponsor dataset and captured form data without hitting the default storage quota.      |
| `host_permissions`: `http://127.0.0.1/*`, `http://localhost/*` | Communicate with the user's own JobHakken desktop app over the local loopback bridge.                         |
| `host_permissions`: `https://www.google-analytics.com/*`       | Send anonymous, metadata-only usage analytics (opt-out) via the GA Measurement Protocol — never user content. |
| Content scripts (job-board / ATS hosts)                        | Detect job postings and autofill application forms on the sites where the user applies.                       |

## Data use disclosure (CWS "Privacy practices" → data collected)

- **Personally identifiable information** (name, contact details, résumé content): handled **only** to
  provide the core autofill/match features. Exchanged with the user's **local desktop app**; **not**
  sent to JobHakken servers, **not** sold, **not** used for unrelated purposes.
- **Anonymous usage analytics** (declare under "User activity"): metadata only — feature-used,
  success/fail, coarse counts, extension version, browser/OS, and a random pseudonymous install id.
  **No content, no page URLs, no precise location** (an allowlist enforces this). Sent to **Google
  Analytics** (third-party) + our first-party endpoint. **Opt-out** in Settings.
- Certifications: does **not** sell/transfer user data to third parties for advertising; does **not**
  use data for purposes unrelated to the single purpose; does **not** use data for creditworthiness.

## Versioning

Keep this file, `manifest.json` `description`, and `package.json`/`manifest.json` `version` in sync.
Update this file in the same PR as any user-facing listing change.

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
git tag ext-v0.11.0 && git push origin ext-v0.11.0
```

The tag push runs the publish job. `workflow_dispatch` with `publish:false` uploads a **draft** only
(no publish) for a dry run.
