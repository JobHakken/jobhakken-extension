# JobHakken extension — changelog

Version shown in the toolbar popup + Options footer (`chrome.runtime.getManifest().version`).
SemVer: **patch** (0.0.x) = fixes/tweaks, **minor** (0.x.0) = a new user-facing feature,
**major** = release milestone. Iterative work stays in patch; minor bumps mark shipped features.

## 0.9.1
- **Renamed to JobHakken.** The extension name, toolbar title, popup, and Options page now read
  **JobHakken** (UI/behavior otherwise unchanged, per the rebrand). The desktop-app bridge
  handshake keeps its internal identifier so existing connections keep working.

## 0.9.0
- **New ATS: SAP SuccessFactors autofill.** The engine now fills SuccessFactors (SAP RCM)
  application forms (e.g. `career4.successfactors.com/portalcareer`). Its dropdowns are
  `sfCascadingPicklist` widgets — an `<input role="combobox">` whose options load on click —
  which the engine was mis-reading as plain text (so Country / State / work-authorization /
  veteran & disability self-ID never filled). They're now classified as comboboxes and driven
  by the interactive pass. Coverage on the captured form is 18/21 fields (86%). Locked in with
  a real-page fixture + regression suite (`sites/successfactors.test.ts`).
- **Fix:** the **GDPR cookie-consent banner** is no longer treated as form fields. In
  particular the *"Consent to cookies from provider LinkedIn"* toggle previously mis-resolved
  to the `linkedin` profile key and could be toggled during autofill — cookie-consent controls
  (by class/id/ancestor/label) are now excluded everywhere.

## 0.8.7
- **Fix:** badges no longer **duplicate** (a row of repeated pills). The green H-1B badge and
  red mark sit next to the same company, so each one's "am I already here?" check saw the other
  badge as the immediate sibling and re-injected — now the check scans a small sibling window,
  so exactly one of each stays. New E2E guards both no-duplication and re-injection-after-wipe.

## 0.8.6
- **Fix (the "works on saved page, gone on live" bug):** LinkedIn is a React app that wipes
  DOM nodes it didn't create on every re-render — so our injected badges flashed in and
  vanished. Badges now **re-inject automatically**: idempotency is keyed on the badge actually
  being present in the page (not a one-time flag), and the company→approvals lookup is cached,
  so each DOM re-render cheaply restores both the green H-1B badge and the red won't-sponsor
  mark. This is why they held on the downloaded (static) page but not live.

## 0.8.5
- **Fix (regression):** the green H-1B badge + popup verdict stopped showing after 0.8.2
  because tile-matching returned early and skipped the reliable detail-pane company. The
  opened job's company is now always looked up (drives the badge + popup), with tiles as
  best-effort on top.
- **Red "won't sponsor" mark now shows on the page too**, next to the green H-1B badge on the
  opened job (previously only in the popup) — both signals appear together on LinkedIn.
- **Richer feedback issue:** "⚑ Report this page" now files a structured GitHub issue (job
  title, company, full posting URL, detection state, sponsorship + H-1B flags, repro steps).

## 0.8.4
- **Classifier hardened against the full 703-job ground truth** (shared core). New catches
  found by a precision/recall audit (`scripts/eligibility-audit.mjs`): plural "no visa
  **sponsorships** available", "unable to consider candidates requiring sponsorship", "U.S.
  Citizen **or Green Card** holder / Permanent Resident", and non-adjacent "Active **SECRET**
  U.S. Government **Clearance**". Precision guards added so these stay clean: permissive
  "citizens, PRs, **or otherwise authorized to work**", "sponsorship **experience**" (skills
  line), positive plural "sponsorships **are available**", and electrical "**creepage/
  clearance**". Result on the 703 jobs: 281 flagged, **0 false positives**.

## 0.8.3
- **Won't-sponsor detection catches more real phrasings** (shared core classifier): e.g.
  "Sponsorship for work authorization, now or in the future, is unavailable" (words between
  "sponsorship" and "unavailable"), "Indefinite U.S. work authorization required", and
  "temporary visas are ineligible". Re-validated on 703 real jobs — still 0 false positives.

## 0.8.2
- **Feedback now goes to a public repo.** "⚑ Report this page" filed to the private
  jobhakken repo (404 for users) — it now opens an issue on the public
  `pranav083/cautious-octo-spork` with the `extension-feedback` label.
- **More live-robust LinkedIn tiles.** The H-1B badge (and won't-sponsor mark) anchor to the
  job-title link inside each list `<li>` (present on every live card regardless of LinkedIn's
  obfuscated classes) and read the company from known elements or the tile's text; badges are
  forced visible with `!important` so host CSS can't hide them. (Still best-confirmed on saved
  pages — see note; a live card's HTML nails it.)

## 0.8.1
- **Fix:** the popup job line showed the site ("linkedin") as the company. It now reads the
  real company from the page title ("Title | Company | LinkedIn").
- **Broader LinkedIn tile matching** for the H-1B badge + won't-sponsor mark: added more
  list-item and company selectors (`scaffold-layout__list-item`, `data-job-id`, entity-lockup
  subtitle, primary-description) since LinkedIn's list DOM uses obfuscated classes. (Detail
  pages are validated; the search-list tiles need a saved list page to fully confirm.)

## 0.8.0
- **Inline H-1B sponsor badges on LinkedIn.** A green "✓ H-1B sponsor" pill now appears next
  to a company on job tiles/pages when that employer has H-1B approvals on record — no need to
  open the popup, and it works **standalone** (a compact ~124k-employer list, ~2.8 MB, is
  bundled and owned by the background worker). Matching sums a brand's exact + word-prefix
  entries ("emerson" → "emerson electric" + "emerson process …") so short LinkedIn names
  resolve like the desktop's fuzzy matcher. The popup shows the same as a green chip.
- **Two complementary signals, by design:** the green H-1B badge is a *company-level* hint
  (has this employer sponsored before?), while the red "🛂 won't sponsor" mark is the
  *role-level* override read from the specific job description — both can appear on the same
  tile (e.g. a sponsoring company posting a citizenship-only role). Both gated by
  "I need visa sponsorship". Regenerate the list with `pnpm run gen:h1b-ext`.

## 0.7.2
- **"Test mode" is now "Demo mode"** (clearer for users) — same anonymous sample identity;
  labels updated across the popup and Options (storage/behavior unchanged). A seeded demo
  *account* is planned for when the hosted/paid tier adds sign-in.
- **Feedback → prefilled GitHub issue.** New "⚑ Report this page" in the popup with quick
  reasons (not detected / autofill missed / wrong sponsorship flag / other). It opens a
  prefilled issue with PII-safe context (host only, version, mode, field count) — and for
  "not detected" it also opts the site in so it works next time.
- **Clearer site control.** "Always active on this site" → "➕ Always run JobHakken on this
  site", with a one-line hint (for job/career sites we don't auto-detect).
- E2E now attaches before/after autofill screenshots so filling quality is visible in the
  report/trace.

## 0.7.1
- **Sponsorship marker now actually attaches on LinkedIn.** The job id is read from the JD
  container's stable id (`JobDetails_AboutTheJob_<id>`) rather than the URL, so it works on a
  single job-detail page (and saved pages) too. On the search list it marks/hides the job's
  **tile**; on a job-detail page (no list) it marks right next to the **job title**. Validated
  against real saved LinkedIn pages (Emerson, West Coast Solutions).
- **Marker + popup verdict are compact.** A small red "🛂 No sponsorship" pill (on the tile/
  title) and a small "🛂 Won't sponsor" chip in the popup — both reveal the full reason on
  hover, instead of a large always-on banner.
- **Autofill can be cancelled and times out.** While running, the Autofill button becomes
  "✕ Cancel" (a second click aborts). The slow AI/résumé step is bounded (20s default, 45s for
  ATS-tailored) so it never hangs — synchronous field fills are kept and reported as partial.

## 0.7.0
- **Toolbar popup is now the whole UI — the floating on-page panel is gone.** The docked
  "⚡" circle was fragile on SPA re-renders (LinkedIn/Workday); the extension is now driven
  entirely from the toolbar icon, which is always available regardless of the page. The popup
  holds everything the panel did: connection/test status, live fillable-field count, Autofill
  (+ ATS-tailored), Job insights (ATS match / visa / keywords), Draft answer, Save job, dev
  Capture, and "always active on this site". It drives the page via a content-script RPC; all
  page work still happens in the content script.
- **Sponsorship marker moved to the job tile.** Instead of a badge in the description, a
  blocked job now gets a red "🛂 No sponsorship" pill + red rail on its list card (tile).
- **New: "Hide these jobs" option** (Options → under "I need visa sponsorship"). When on,
  won't-sponsor jobs are hidden from the list rather than marked. LinkedIn reveals the full
  description only when a job is opened, so a job is judged on open; the desktop app hides
  them upfront (it has every job's full description).

## 0.6.1
- **Fix:** the sponsorship badge now matches the current LinkedIn DOM. LinkedIn ships
  obfuscated CSS classes with a stable id prefix `JobDetails_AboutTheJob_<jobId>`; the badge
  now targets `[id^="JobDetails"]` (older `#job-details` + generic `job-description` kept as
  fallbacks) and reads `textContent` so a collapsed "…show more" description is still
  classified. Validated against a real saved LinkedIn page.
- **Fix (privacy):** in test mode the popup and Options no longer show the real cached
  identity — the connection line reads **"Connected · 🧪 Test mode"** instead of your name.
- **Fix (reliability):** the on-page panel/bubble re-attaches itself if a single-page-app
  re-render (LinkedIn, Workday) drops its host, so the ⚡ icon reappears instead of vanishing.

## 0.6.0
- **Visa-sponsorship filter (local, no AI).** New Options toggle **"🛂 I need visa
  sponsorship"** (off by default). When on, job pages (LinkedIn and generic career sites)
  whose description explicitly rules out sponsorship — U.S. citizenship, a security
  clearance, "no sponsorship," or export-control (ITAR/EAR) — get a warning badge on the
  open job, and that job's list card is dimmed. Runs entirely on-device using the same
  classifier the desktop app uses (`@jobhakken/core`, validated against ~700 real jobs).
  LinkedIn list cards lack the full description, so only the opened job is judged; the
  desktop feed does the full hiding. Reflected live when toggled (no reload). E2E-guarded.

## 0.5.3
- Live connection status: the panel showed "Connected" from cached credentials even after
  the desktop app was closed. It now **polls the bridge** (on load, tab focus, every 8s),
  so closing the app flips to **Standalone** and reopening it **auto-reconnects** — the
  status reflects real reachability. Cached creds still allow standalone autofill.

## 0.5.2
- Fix the panel flashing on non-application pages (e.g. GitHub settings). The "looks like
  an application" heuristic no longer triggers on a bare count of profile fields
  (name/email/company also appear on settings pages) — it now requires a real
  job-application signal: a résumé/CV upload, or an EEO/screening field (work
  authorization, sponsorship, cover letter, salary, veteran/disability, …).

## 0.5.1
- Options → "Import from my résumé" now respects test mode: when test mode is on (the
  extension toggle, or the connected app's sandbox), Import loads the **anonymous dummy
  profile** instead of your real résumé, and the button stays usable even without a
  connection. E2E guards it.

## 0.5.0
- Auto-capture now records the **whole application flow**, not just structure: per field,
  whether it was **filled by autofill, filled manually by you, or left empty**, plus a
  PII-safe value (your details scrubbed; emails/phones/long text → shapes like `[email]`;
  short answers like "Yes"/"LinkedIn" kept). Updated live as you fill (debounced), one
  evolving record per application URL. The **manually-filled fields are the autofill gaps**
  — the key learning signal.
- Options copy clarified: **Auto-capture** = the local corpus (default on, with Export);
  **Fixture capture (developer)** = the separate one-off download tool.

## 0.4.6
- Test mode is now unmistakable + synced:
  - **Desktop app:** an app-wide amber "🧪 TEST MODE — sandbox with dummy data, your real
    jobs & résumé are safe" banner on every screen, with an "Exit test mode" button. (An
    empty test sandbox can no longer be mistaken for data loss.)
  - **Extension:** the panel's TEST banner live-syncs to the app's test mode (refreshes on
    tab focus + periodically), matching the fill behavior which already uses dummy data
    whenever the app is in its sandbox.

## 0.4.5
- Manage the sites the extension is active on:
  - **Panel:** "➕ Always open JobHakken on this site" — one click adds the current host
    (panel opens + auto-captures there); shows "✓ active" once added.
  - **Options → My sites:** list your added domains with remove (✕), plus add any domain
    by hand (e.g. `careers.company.com`). Built-in ATS list stays always-on.

## 0.4.4
- Tighten when the panel opens — the v0.4.3 gate used "any fillable field", so a lone
  search box (google.com etc.) tripped it. Now the panel opens ONLY on job-application
  pages: a known ATS host, an ATS-fingerprinted page, a user-opted-in site, or a page
  that looks like an application form (≥3 fields map to profile data, or a résumé upload).
  E2E asserts it stays hidden on a search-box page.

## 0.4.3
- Fix: the panel no longer appears on every website — it shows only on **application
  pages** (fillable fields present, or a page fingerprinted as a known ATS). This also
  makes it appear on ATS pages like Greenhouse even before the form finishes loading
  (re-evaluated on DOM changes). Starts hidden to avoid a flash on ordinary pages.

## 0.4.2
- Fix: no more "allow this site to access local device" prompt on every page. Bridge
  calls (127.0.0.1) are now proxied through the background service worker (extension
  origin) instead of fetched from the content script (page origin), which the browser
  gated behind a per-site permission prompt. Same functionality, zero prompts.

## 0.4.1
- Fix: test mode is now consistent across ALL personal data. A single `isTestActive()`
  (extension toggle OR connected-app sandbox) governs the profile **and** documents, so
  résumé upload no longer fetched the real résumé (real name) when test mode came from
  the app. AI "Draft answer" is disabled in test mode (it's grounded in the real résumé).
  Job insights / linking stay on the real connection — jobs carry no personal data.

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
