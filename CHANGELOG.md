# JobHakken extension — changelog

Version shown in the toolbar popup + Options footer (`chrome.runtime.getManifest().version`).
SemVer: **patch** (0.0.x) = fixes/tweaks, **minor** (0.x.0) = a new user-facing feature,
**major** = release milestone. Iterative work stays in patch; minor bumps mark shipped features.

## 0.22.1
- **Sign-in is now always visible.** A persistent sign-in chip sits in the header of the Profile &
  settings page — “Sign in” when signed out (click → JobHakken login), your account once you’re in — on
  every section. Previously sign-in was reachable only inside the Account section.

## 0.22.0
- **H-1B company insights, right in the popup.** For the company on the current job page, expand the new
  “🛂 H-1B history” panel to see how many H-1B petitions they’ve filed, the typical wage (and range), and
  a scrollable **table of the top sponsored roles with per-role filings and wages** — all summed across
  the company’s legal entities (e.g. Amazon’s ~17k filings, not the 2 you’d get from an exact-name match). It’s a **premium** feature: available on a paid/builder
  account or when the desktop app is connected; everyone else sees a short prompt. Data is bundled and
  looked up on-device — nothing about the page leaves your browser.

## 0.21.3
- **Managed-AI subscribers now read their real plan.** When signed in, the extension fetches your tier
  from the webapp’s `/api/entitlement` (source of truth: `profiles.subscription_tier`) using your access
  token, instead of a token field that was never populated — so a Plus/Pro/Max plan is finally
  recognised. Using your own AI key is unaffected. (Activates once the backend endpoint is live.)

## 0.21.2
- Internal: bump the shared `@jobhakken/core` library 0.1.0 → 0.2.0 (cross-surface sync-consumer /
  materialize groundwork, ADR-0009). No user-facing change; sponsor/eligibility classifiers unchanged.

## 0.21.1
- **Groundwork for signing in with your JobHakken account.** Fixed the auth handshake so the extension
  can detect your website sign-in — it now reads the session from the app.jobhakken.com cookie (the app
  moved to cookie-based sessions, including large chunked sessions) instead of localStorage where it no
  longer lives. Using your own AI key is unaffected; managed AI for subscribers still needs a couple of
  backend pieces before it’s live.

## 0.21.0
- **Redesigned Profile & settings page.** The row of tabs is now a calm left sidebar with collapsible
  sections and a “you’re X% ready to apply” bar at the top, so it’s clear what’s set up and what’s left.
  Long explanations are tucked behind ⓘ icons (click or hover for the detail), and the duplicated
  desktop-app setup is merged into one place. Every field and setting is unchanged — just easier to move
  through, and it still respects your light/dark theme.

## 0.20.3
- **Custom Fields → “Advanced: matching operators” now shows worked examples.** It was just a legend of
  symbols; now it shows what each one does on a real field label (e.g. `^salary` starts-with, `salary &&
  !current`, `sponsor || visa`, `=gpa` exact), so targeting tricky questions is clear.

## 0.20.2
- **Screening questions on Lever-style applications now fill.** Custom dropdown questions whose label
  sits next to the field (common on Lever and similar forms) were being skipped; the copilot now reads
  those side-labels and answers them. Bumps the autofill engine 0.1.0 → 0.2.1, which also brings the
  accumulated engine improvements (answer-bank, intl phone E.164, Oracle/react-select comboboxes,
  Ashby EEO/work-auth) that had never shipped to the extension.

## 0.20.1
- **Common questions, one click to add.** Custom Fields now has a row of the questions people hit most
  (notice period, start date, relocate, sponsorship, references, GPA…) — click one to add it, pre-filled
  with a sensible answer to edit. JobHakken can't put every possible field on the profile page, so this
  makes the ones you run into quick to set up.

## 0.20.0
- **Don't like an AI answer? Refine it.** After drafting, the popup lets you pick a drafted question,
  tell the AI what to change (e.g. "make it shorter and mention my Python experience"), and redo just
  that one answer — using your own key, still review-first, never submitted.

## 0.19.2
- **Clearer "Autofill" vs "Autofill + AI".** After "Autofill + AI" the popup now shows a distinct
  "✍️ N AI answers" chip, so you can see what the AI wrote versus what was filled from your profile —
  and those AI answers are the purple-outlined ones on the page.

## 0.19.1
- **Résumé upload now attaches to applications — without the desktop app.** Uploading a PDF/Word résumé
  in Settings now keeps the file and attaches it to application forms (it used to only work when the
  desktop app was connected, so standalone users saw the résumé field left empty). Kept on your device.

## 0.19.0
- **Jobvite applications no longer get stuck at the "Location of Residence" step.** When your country
  clearly matches an option, JobHakken selects it to reveal the form and fills it in the same click.
  It only does this when it can match your *own* stated country — it never picks a residence/consent
  option for you otherwise, and never submits.

## 0.18.1
- **A reminder to set your EEO/demographic answers once.** A résumé never contains gender/race/veteran/
  disability, and JobHakken never guesses them — so the Additional tab now nudges you to set them once
  (with "Decline to self-identify" as the common choice), and the résumé parser points you there too.

## 0.18.0
- **Upload a Word (.docx) résumé too, not just PDF** — and the upload is now a clear, prominent button
  ("Upload a PDF or Word file"), no longer easy to miss.
- **Review fields are now outlined in bright violet** (was a faint amber) — much easier to spot the
  fields to check on the page.
- **Custom Fields is easier to use** — an examples table (e.g. "notice period" → "2 weeks", "how did
  you hear" → "LinkedIn") and clearer input hints.

## 0.17.0
- **Two clear buttons: "Autofill" and "Autofill + AI".** "Autofill" fills the form; "Autofill + AI"
  fills *and* drafts the open-ended answers in one click.
- **You can now see exactly what to review.** Fields JobHakken fills but that you should double-check
  (defaults, AI drafts) are **outlined in amber on the page**, and the popup's "N to review" is a button
  that scrolls straight to them — no more guessing what "to review" means.

## 0.16.0
- **Upload a PDF résumé (not just paste).** The "Parse a résumé" panel now takes a PDF — the extension
  reads the text on-device and drops it into the box for you to review, then parse with AI. Works for
  normal text-based PDFs; a scanned/image-only PDF can't be read, so you'll be asked to paste instead.

## 0.15.1
- A gentle, one-time "enjoying JobHakken? leave a review" note appears in the popup after a couple of
  good autofills — dismissible, shown at most once ever, counted only on your device.

## 0.15.0
- **Sign in with your JobHakken account.** Settings → "Sign in with JobHakken" opens the JobHakken
  website (the same login you use everywhere — password, code, or Google); once you're in, the
  extension picks up your account automatically. It's the groundwork for managed AI and syncing across
  devices. Optional — the extension still works without an account, and free with your own AI key. Your
  sign-in stays on your device; only your email/plan is kept (never your password or refresh token).

## 0.14.0
- **Fill your profile from a résumé with AI — no desktop app.** In Settings → Profile, paste your
  résumé text and click "Parse with AI"; it extracts your name, contact, links, and work/education
  history into the fields for you to review. Uses your own AI key (Settings → AI drafting), only uses
  what's written (never invents details), and never sends your résumé to JobHakken. Sensitive fields
  (salary, EEO, work authorization) are never guessed from a résumé.

## 0.13.2
- **"Draft answers" now works with just your AI key.** Fixed: the button was only shown when the
  desktop app was connected, so someone using only their own AI key couldn't reach it. It now appears
  whenever a key is set (or the app is connected). "Save job" stays desktop-only.

## 0.13.1
- **See your AI usage in the popup.** After drafting answers, the popup shows a running "N drafts this
  month · X tokens · ≈ cost" line so you always know what the AI has used. It's counted on your device
  only and never sent to JobHakken; the cost is an estimate at gpt-4o-mini rates (your actual rate
  depends on the model you choose).

## 0.13.0
- **Draft answers with your own AI key — no desktop app needed.** Open-ended application questions
  ("What excites you about this role?", "Describe a project you're proud of") can now be drafted right
  in the extension. Add your own AI key (OpenRouter, OpenAI, or any compatible provider) under
  **Settings → AI drafting** and it works on any plan, at no cost to us. Everything else — name,
  contact, work authorization, EEO, dropdowns — still fills with **no key and no AI**; the key only
  drafts the essay questions rules can't answer. Answers are always shown for you to review, never
  submitted. Your key is kept in memory for the browser session only and never sent to JobHakken.

## 0.12.1
- **Autofill now fills every field by default — including work authorization, visa sponsorship,
  salary, and EEO/demographic questions.** It's your own data and nothing is ever submitted for you
  (you review first), so the copilot no longer leaves these common, required questions blank. You can
  still turn off "Autofill sensitive fields" in Settings if you'd rather fill those by hand.

## 0.12.0
- **A real first-run experience.** Installing the extension now opens a setup page with a short
  “Getting started — three steps” guide, so you’re never staring at a cold toolbar icon wondering
  what to do. Dismissible once you’re set up.
- **The popup guides you when there’s nothing to fill.** Instead of a dead-end message, it now shows
  a **“Set up your profile →”** button (and again on a job page if your profile isn’t set up yet).
- **Clearer setup.** The old “Desktop” tab is now **“Settings”**, with a **“Connect the app”**
  section moved to the top so it’s the first thing you see (not buried under other options). It
  explains what connecting unlocks, links to the download, and drops the technical wording —
  “connection code” instead of “token”, no raw IP address, no “beta”.
- **Fix:** on a page with nothing to fill, the **Autofill** button is now correctly disabled (a
  latent error previously left the empty-state half-rendered).
- **Less clutter on the settings page.** Rewrote the dense, developer-flavoured text in plain
  language and tucked the power-user / engineering controls (custom sites, “help improve autofill”,
  developer capture, rule operators) behind a collapsed **Advanced** section, so a first-time user
  only sees what matters to them.

## 0.11.4
- **Plainer language throughout.** Replaced insider jargon with words anyone can follow:
  "Standalone" → "App not connected", "No profile" → "Profile not set up", the visa badges now
  read "Sponsors visas ✓" / "Won't sponsor visa" (instead of "H‑1B sponsor" / "No sponsorship"),
  the résumé-tailoring button drops "ATS", the match score reads "Résumé match", and the connected
  status no longer shows a raw IP address.

## 0.11.3
- **Fix: clearer results for "Draft answer" and "Save job".** Both buttons now show a full,
  plain-language outcome (success or a helpful reason) beneath them instead of a cut-off error
  stuck on the button — e.g. "Turn off Demo mode to use this on real data." or "Open the
  JobHakken desktop app first, then try again."

## 0.11.2
- **Fix: "⚑ Report this page" now files to our real tracker.** Feedback was pointing at a
  placeholder repo; it now opens an issue on the public
  [JobHakken-issues](https://github.com/JobHakken/JobHakken-issues) tracker (tagged
  `extension-feedback`), so reports actually reach us.

## 0.11.1
- **Stronger privacy while autofilling.** Autofilled values are no longer written into page DOM
  attributes where the site's own scripts could read them back — the extension now tracks what it
  filled entirely in memory.
- **Hardened desktop-app connection.** The localhost bridge to the desktop app now only accepts a
  fixed set of methods, verifies the caller, validates the port, and caps response sizes — so a
  misbehaving local program can't stall or overload the extension.
- **Safer question autofill.** Free-text question fields are only filled when there's a clear label
  match, and the extension prefers the field inside the form you're on.
- **Reliability & polish.** Capture writes are serialized (no lost/duplicated saves), stored PII is
  redacted more thoroughly, popup text is fully HTML-escaped, and analytics only ever report a
  coarse browser/OS and never throw.

## 0.11.0
- **Anonymous, opt-out usage analytics.** A new **Settings** toggle (on by default) lets the
  extension share **metadata-only** usage stats — which features you use, success/failure, the
  extension version, and browser/OS — to help improve the product. It **never** sends your résumé,
  job postings, form values, or personal data, and you can turn it off anytime.
- **Tighter permissions & safety.** The copilot no longer injects into non-job local pages (removed
  the broad `localhost` content-script match), an explicit content-security policy is enforced, and
  connection/status text is HTML-escaped.
- **Fix: Cancel during autofill.** A completing run could wipe a newer run's abort controller and
  break its Cancel — now a completing run only clears its own, so Cancel always stops the active run.

## 0.10.0
- **Save a job to the desktop feed.** The popup's **Save job** button now adds the open role to
  the desktop app's tracker (the New column) over the local bridge — deduped by URL, so
  re-clicking never creates a duplicate. Needs the app open. (Was a "coming soon" stub.)
- **Loupe brand mark.** The popup + Options header now show the JobHakken **loupe** monogram —
  matching the desktop app, website, and toolbar icon. The old diamond mark is retired everywhere.
- **Fix: visa-sponsor lookup used the site name.** Analyze was querying the *hostname*
  ("linkedin") instead of the real employer, so the H-1B / UK sponsor signal often missed. It now
  reads the actual company from the page title.

## 0.9.3
- **Manual light/dark theme toggle.** A 🖥→☀→🌙 button in the popup header and on the Options
  page. Default follows the system theme; Light/Dark override it and the choice persists across
  both surfaces (`chrome.storage`). The Options (profile) page got real dark tokens so the whole
  form reads correctly in dark, not just the save bar.
- **Brand-matched UI.** The popup + Options now use the JobHakken website palette (sage-green on a
  warm canvas, off-white text — pulled from `landingPage` design tokens) instead of the old indigo
  accent, and the in-app logo is the **same diamond mark as the toolbar icon** (was a ⚡ gradient).
  One consistent identity across the icon, popup, and options.

## 0.9.2
- **Store-ready packaging.** The toolbar + Web Store icon set (16/32/48/128) is now declared in
  the manifest and **generated at build time from the website brand mark**
  (`apps/landingPage/public/favicon.svg`) — one source of truth, so a rebrand of the favicon
  flows into the extension automatically. Added a `pnpm run package` script that builds and
  emits the upload `.zip`.
- **Scoped the content script to job sites.** It no longer runs on every page (`<all_urls>`) —
  it now activates only on job boards + applicant-tracking hosts (LinkedIn, Indeed, Workday,
  Greenhouse, Lever, iCIMS, SuccessFactors, Ashby, SmartRecruiters, Taleo, …), with
  `all_frames` so embedded ATS forms on company career pages still work. Cleaner permissions +
  faster Web Store review.

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
