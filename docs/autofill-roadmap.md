# JobHakken Autofill — coverage & robustness roadmap

_Future direction for building ATS autofill coverage and keeping it robust as it scales.
Written 2026-07-30. Companion to `ats-coverage-status.md` + `ats_site_list.md` + `more-lisiting.md`._

## The core insight (why this plan is shaped the way it is)

The **fill engine already generalizes** — proven on 10 golden Tier-1 families + Workday (2 tenants),
Teamtailor, SmartRecruiters, and (with the human-capture tool) iCIMS + Oracle. What actually blocks
coverage is never "can the engine fill a form"; it's four recurring, _nameable_ obstacles:

1. **Gates** — CAPTCHA, account/login, custom-SPA gates (Knockout/OJET) that automation can't cross.
2. **Widget dialects** — each ATS renders the _same_ logical field with a different control (Workday
   multiselect prompt, Oracle address-grid combobox, jQuery-UI selectmenu, styled checkboxes).
3. **Custom questions** — free-text screening/essay questions that don't map to any profile field
   (the recurring "filled X of Y" gap). These need AI, not mapping.
4. **Link rot** — real job postings expire in weeks; any fixed URL list decays.

The plan is organized around neutralizing each of these _systematically_ rather than site-by-site.

## The ATS landscape (prioritize by reach, not by what's easy)

**Done (golden or live):** Greenhouse, Lever, Ashby, Workable, JazzHR, Jobvite, Recruitee, BambooHR,
SuccessFactors, Workday, Teamtailor, SmartRecruiters, + iCIMS/Oracle (via human-capture).

**Next tier — high job volume, not yet covered end-to-end:**

- **Dayforce** (no captcha — automatable like Workday; fresh URLs in `more-lisiting.md`)
- **Taleo** (legacy, server-rendered — easiest to fixture; Textron/Starbucks/Zions live)
- **BrassRing/Kenexa** (account gate already scripted; Lockheed Martin live)
- **Oracle Recruiting Cloud** (address-grid fix shipped; JPMC/Akamai live)
- **iCIMS** (captcha gate; GD/DMI/Getty live)
- **Paycom** (JS shell + robots-blocked — lower priority)

**Not yet on our radar (the "bigger universe" — add by market share):**
UKG Pro / UltiPro Recruiting · ADP Recruiting · Cornerstone OnDemand · Avature · Bullhorn · JobDiva ·
Paylocity · Phenom People · Eightfold · Gr8People · Gem · Rippling · Pinpoint · Personio · iSolved ·
ADP WorkforceNow. (Enterprise US roles cluster in Workday/Taleo/Oracle/iCIMS/BrassRing/SuccessFactors;
SMB/tech in Greenhouse/Lever/Ashby — we already cover the two biggest clusters' cores.)

## Pillar 1 — A repeatable capture→fixture→golden pipeline (kills link-rot + drift)

The single most important investment. Turn every reachable form into a **permanent, CI-verified
golden**, so coverage never silently rots.

1. **`capture-run.mjs` (built)** — headed, human clears the gate once, captures the _form frame_.
2. **Scrub step (to build)** — strip session/CSRF tokens, cookies, PII, and external asset URLs from
   the captured HTML before it enters the repo (captures currently kept out of git for this reason).
3. **Golden authoring (semi-automate)** — from a scrubbed capture, auto-generate a `*.golden.json`
   skeleton (detected fields + resolved keys) for a human to confirm expected values.
4. **CI gate** — `npm run smoke` runs all goldens offline every build; a coverage regression reddens
   the gate (already the model for the 10 existing families).
5. **Re-capture cadence** — because live jobs rot, goldens are captured _once_ and are URL-independent
   thereafter; only re-capture when an ATS redesigns (detected by the live canary, below).

## Pillar 2 — A widget-dialect library (kills the per-ATS widget problem)

Each new ATS mostly reuses a small set of control patterns. Keep growing a tested library of handlers
so a "new" ATS is usually just composition, not new code:

- ✅ listbox combobox · ✅ react-select (portaled) · ✅ Workday multiselect prompt · ✅ autocomplete-grid
  combobox (Oracle address) · ✅ segmented date pickers · ✅ styled/React checkboxes · ✅ jQuery-UI
  selectmenu · ✅ intl-tel phone · ✅ radio button-pairs.
- **To add:** typeahead-with-remote-search that _requires_ selection (Workday School — currently a
  dead-end), Angular-accordion sections (BrassRing form), OJET web components.
- **Rule:** every handler ships with a deterministic unit test reproducing the widget's _contract_
  (as in `widgets.test.ts`), so it's verified without a live site.

## Pillar 3 — Gate strategy (make gates a solved, not blocking, problem)

- **Account gates, no captcha (Workday, Dayforce, BrassRing):** fully automatable via temp-email
  account creation — the highest-ROI expansion path. Build one shared "create throwaway account"
  helper (mail provider abstraction — mail.tm/guerrilla/etc. with fallback, since any one rate-limits).
- **CAPTCHA (iCIMS, SmartRecruiters-on-submit):** never automate. Two honest positions: (a) real users
  solve it themselves as part of applying — the engine activates post-gate; (b) for testing, the
  human-capture tool passes it once → golden. Document this as by-design, not a bug.
- **Custom-SPA gates (Oracle Knockout, OJET):** the _gate_ resists synthetic events but real users
  don't; treat like CAPTCHA (capture once). The _form_ behind it is fillable (proven).
- **Provider abstraction for temp email + OTP reading** so overnight/CI runs don't die on one
  provider's rate limit (tonight's failure mode).

## Pillar 4 — AI fill for the unmapped questions (closes the "X of Y" gap)

The recurring gap on every real job is custom free-text/screening questions ("Why do you want to work
here?", "Describe a project…", employer-specific yes/no). These are out of scope for seed-mapping.

- Route unmapped, non-sensitive questions to the managed-AI proxy (per ADR-0003/0009: stateless,
  metered, ZDR; never for BYO-secret leakage) to draft answers from the résumé + job description.
- Keep it review-first (never auto-submit); surface AI answers as "review" status.
- This is what turns "fills 7 of 17" into "fills the whole form" on real postings.

## Pillar 5 — Drift detection & maintenance (stay robust over time)

- **Live canary (`test:live` exists):** periodically drive the extension against a rotating set of
  live public ATS pages in Demo mode; report per-site coverage deltas. Flags selector drift + new
  widget dialects before users hit them.
- **Correction signal (exists, dev-only):** rank the fields autofill most often misses → the next
  seed-rule / widget-handler backlog, data-driven.
- **Versioned engine contract:** `@jobhakken/core` / `@jobhakken/autofill` are contract-enforced
  (bump → all surfaces adopt, per ADR-0004/0007). Keep the golden gate as the merge gate.
- **Anonymous test identity only** (Jordan Rivera / example.com); valid-by-validator dummy data
  (libphonenumber phone, real institution names, www LinkedIn) — real validators reject fake data.

## Phased execution

- **Phase A (now):** Dayforce end-to-end (no captcha, fresh URLs) → 2nd fully-automated Tier-2 after
  Workday. Then Taleo goldens (server-rendered, easiest). Ship the capture-scrub step.
- **Phase B:** AI-fill for unmapped questions (Pillar 4) — biggest per-form coverage jump.
- **Phase C:** Broaden the widget-dialect library (School remote-search, Angular accordion, OJET) →
  unlocks BrassRing/Oracle _forms_ fully + de-risks the next wave of ATS.
- **Phase D:** Add the next-tier ATS (UKG, Cornerstone, ADP, Bullhorn…) via the capture pipeline;
  each becomes a golden, not a fire-drill.
- **Phase E:** Drift automation — scheduled live canary + correction-signal review as a standing loop.

## Success measure

Not "how many ATS we clicked once" but **how many ATS have a green golden in CI** (rot-proof coverage)

- **median % of a real form filled** (raised by AI-fill). Track both over time.
