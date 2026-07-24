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

`Autofill job applications smartly, with a job-description match, H-1B/UK visa signal, and a résumé tailored for the job.`

## Detailed description (keyword-spam-free)

```
JobHakken's Apply Copilot fills out job applications for you and helps you decide which roles are
worth your time — right in your browser, working with the JobHakken desktop app.

As you browse a job posting, it:
• Autofills the application form from your saved profile, so you stop retyping the same details.
• Shows how well your résumé matches the posting, so you focus on roles that actually fit.
• Surfaces visa-relevant signals (H-1B in the US, work-visa in the UK) when they apply to you.
• Tailors your résumé to the posting, so each application reads like it was written for that role.

It works across major job boards and applicant tracking systems — no per-site setup.

Privacy: your résumé and application data stay on your device and are exchanged only with your local
JobHakken desktop app. The extension does not send your content to our servers.

Requires the JobHakken desktop app.
```

---

## Permission justifications (CWS "Privacy practices" → per-permission)

| Permission                                                     | Justification                                                                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `storage`                                                      | Save the user's autofill profile and preferences locally in the browser.                                   |
| `unlimitedStorage`                                             | Cache the bundled H-1B sponsor dataset and captured form data without hitting the default storage quota.   |
| `host_permissions`: `http://127.0.0.1/*`, `http://localhost/*` | Communicate with the user's own JobHakken desktop app over the local loopback bridge. No external servers. |
| Content scripts (job-board / ATS hosts)                        | Detect job postings and autofill application forms on the sites where the user applies.                    |

## Data use disclosure (CWS "Privacy practices" → data collected)

- **Personally identifiable information** (name, contact details, résumé content): handled **only** to
  provide the core autofill/match features. Exchanged with the user's **local desktop app**; **not**
  sent to JobHakken servers, **not** sold, **not** used for unrelated purposes.
- No web-browsing history, no analytics of page content. (Any future telemetry is metadata-only and
  disclosed separately — see the app's privacy model.)
- Certifications: does **not** sell/transfer user data to third parties; does **not** use data for
  purposes unrelated to the single purpose; does **not** use data for creditworthiness/lending.

## Versioning

Keep this file, `manifest.json` `description`, and `package.json`/`manifest.json` `version` in sync.
Update this file in the same PR as any user-facing listing change.
