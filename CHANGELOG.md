# First2Apply extension — changelog

Version shown in the on-page panel header and Options footer (`chrome.runtime.getManifest().version`).

## 0.4.0
- Redesigned on-page panel (autofill-first):
  - **Two autofill actions** with the résumé merged in — **Autofill** (your default
    résumé) and **Autofill + ATS** (résumé tailored to this job via the new
    `tailoredResumeFile` bridge RPC). No separate attach step.
  - **Job insights collapse** behind a click-to-expand bar (ATS match ring, H-1B/visa
    signal, keyword gaps) so autofill stays the focus; analyzed lazily on expand.
  - **Settings gear** in the header; **Draft answer** (AI, fills the first screening
    field) and Save as small secondary buttons.
  - **Not connected → only Autofill** is shown; all app/AI surfaces are omitted.
- Save-to-feed is stubbed ("soon") pending proper job creation.

## 0.3.2
- Test mode now **syncs with the desktop app**: a `status` bridge RPC reports the app's
  sandbox state, and the extension fills anonymous data whenever *either* its own toggle
  or the connected app is in test mode (no more mismatched modes).
- Company career sites: auto-capture now also fires when a page is **fingerprinted as an
  ATS** (Workday/Greenhouse/Lever/… running under a company domain / in an iframe), not
  just on the hostname allowlist.

## 0.3.1
- Auto-capture now scoped to a **known-ATS allowlist** (Workday, Greenhouse, Lever,
  Ashby, iCIMS, SmartRecruiters, Workable, Taleo, SuccessFactors, BambooHR, Jobvite, …)
  — no more capturing arbitrary non-application pages that happen to have a few fields.
- **Per-site opt-in**: on an unknown host, the panel offers "Capture applications on this
  site" so you decide. Everything still anonymized + local.
- Corpus storage moved to per-record keys + a small index (no more rewriting the whole
  corpus on each save) — matters for a heavy multi-day run.
- (Full form-region capture kept as the default during the discovery phase; a compact
  coverage-only format will come once the corpus shows which signals actually matter.)

## 0.3.0
- Auto-capture corpus (default on): passively snapshots every job-application page
  (≥4 fields), scrubs your personal details at source, and stores it locally
  (chrome.storage.local, `unlimitedStorage`) to learn field coverage over time. Never
  opens dropdowns / touches the form, never captures other browsing, never leaves the
  machine. Options: toggle + count + **Export corpus** + Clear.
- Aims: strengthen the offline seed/filters from real data and pinpoint where LLM calls
  are actually needed — reducing manual data entry over time.

## 0.2.4
- Cover-letter upload: your default cover-letter text (saved in the profile) is rendered
  to a PDF in-browser and attached to cover-letter file inputs on Autofill — no AI needed.
  Test mode uses the bundled dummy. Shared minimal PDF builder (lib/pdf.ts).
- E2E now also asserts the cover letter attaches.

## 0.2.3
- Real résumé upload: when connected to the desktop app, Autofill attaches your latest
  saved résumé (rendered to PDF by the app's `resumeFile` bridge RPC). Test mode still
  uses the bundled dummy PDF.
- Playwright E2E now asserts résumé upload (DataTransfer) + live lazy-combobox pick in a
  real browser — coverage jsdom can't provide.

## 0.2.2
- Answer bank: sensible default answers for common screening questions that don't map to
  a profile field — e.g. "Have you previously worked here?" → No (review confidence; a
  user rule always overrides). Desktop app gains an isolated Test Mode (Settings).

## 0.2.1
- Precision from a real live Workday capture: exclude page-chrome comboboxes (language /
  settings header menus) and anonymous framework helper inputs (hidden combobox
  value-holders) from detection. Real "My Information" coverage 17/27 → 17/20.
- New fields: Suffix, County (appear on Workday) — resolved + fillable.
- Added the live Workday "My Information" capture as a regression fixture.

## 0.2.0
- **Multi-row sections:** clicks "Add another" to create a row for every Work Experience
  and Education entry (Workday + Greenhouse), then fills each.
- **Résumé / cover-letter auto-upload** on Autofill (test mode uses a bundled dummy PDF;
  real files come from the connected desktop app / your default).
- Larger dummy test profile (extra experience + education entries) to exercise multi-row.
- Version now surfaced in the panel + Options for change tracking.

## 0.1.0
- Docked panel + popup; standalone or desktop-connected autofill.
- Generic engine: seed dictionary, learned mappings, attribute + fuzzy resolution.
- Real ATS fixtures (Greenhouse, Workday) + per-site tests.
- Fill sensitive fields by default with an opt-out.
- Workday lazy-combobox live picker + segmented date-picker fill.
- Test mode (anonymous dummy data) + Capture mode (one-click PII-safe fixtures + coverage).
- Work-experience bullet-point highlights.
