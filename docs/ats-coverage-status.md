# JobHakken Autofill — ATS Coverage Status (working prototype)

_Last updated: 2026-07-30 (overnight autonomous run). Companion to `ats_site_list.md`._

## TL;DR — what's working today

The extension's **fill engine** (`@jobhakken/autofill`) is the prototype. It detects fields on any
application form (text/select/radio/checkbox/combobox/multiselect/date/file), resolves them to a
profile via a seed dictionary + answer-bank + user rules, and fills them — **never submitting**. It
is proven on:

- **11 Tier-1 ATS families** — verified by committed golden tests (right value in right field).
- **Workday (Tier-2, live)** — full My Information across **two tenants** (NGC + Vizient), advancing
  the multi-step wizard and uploading the résumé.

The remaining Tier-2 ATS are blocked by their **gates** (CAPTCHA / account / login), not by the
extension's ability to fill — once a human is past the gate, the same engine fills the form.

## Tier 1 — single-page forms (DONE, golden-verified)

Greenhouse (classic + React job-boards), Lever, Ashby, Workable, JazzHR, Jobvite, Recruitee,
BambooHR + SuccessFactors + a synthetic combobox/upload fixture (10 golden fixtures).
Gate: `npm run smoke` (12 goldens). These fill 100% of the mapped fields offline and deterministically.

**Teamtailor** — live-verified 2026-07-30: reaching the form needs an "Apply for this job" click, then the engine fills 7/9 (name, email, phone, salary, Yes/No radios; the 2 gaps are custom essay questions). Golden capture pending. **SmartRecruiters** — its one-click apply form is CAPTCHA-gated across companies (Axiado, Aczet), so it moves to the manual-intervention group below.

## Tier 2 — enterprise, login/gated multi-step

| ATS                                         | Live status       | Gate                                     | Extension result                                                                                                                                                                                                                |
| ------------------------------------------- | ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workday** (NGC, Vizient)                  | ✅ live, tested   | account (temp-email, no CAPTCHA)         | **My Information 100% + advances**; My Experience core fields fill. See below.                                                                                                                                                  |
| **Oracle Recruiting Cloud** (Hologic, JPMC) | ✅ live           | email + terms (Knockout SPA, no CAPTCHA) | Gate fully mapped. **Blocker: Knockout observables ignore synthetic DOM events** (each field re-render reverts the other to empty) so automation cannot pass the gate; a real user’s typing/clicks work. Form fill unverified.  |
| **iCIMS** (Markon)                          | ✅ live           | email + privacy + **hCaptcha**           | Gate form detected (2 fields). **hCaptcha blocks automation** — a real user solves it, then the engine fills the form.                                                                                                          |
| **Dayforce** (York Space)                   | ❌ links dead now | account/sign-in (no CAPTCHA)             | Both listed jobs expired; automatable with a fresh URL.                                                                                                                                                                         |
| **BrassRing/Kenexa** (General Atomics)      | ✅ live           | cookie + account (no CAPTCHA)            | **Account creation fully automated** (email + password + 3 jQuery-UI security questions, distinct/unique) → reaches the Contact Information form. Form fill blocked: collapsed Angular accordion + RPC re-render (like Oracle). |
| **Taleo** (Kearney, Schneider)              | ❌ job links dead | account                                  | Link rot — needs fresh live job URLs.                                                                                                                                                                                           |
| **Paycom**                                  | ❌ job link dead  | account                                  | Link rot ("We couldn't find this job").                                                                                                                                                                                         |

### Workday — detail (the deepest-verified Tier-2)

Fixed + committed this run, verified live on NGC **and** Vizient (proves it generalizes, not
hardcoded):

- **Phone Device Type** → "Personal Mobile"/"Mobile" (was mis-resolving to the phone number).
- **Country Phone Code** → new support for Workday **multiselect prompts** (type-search → pick → commit).
- **Prior-worker screening radio** → "No" (fixed an `(apt)`→"aptitude" false-match).
- **Valid phone / www LinkedIn / real school** test data (real region/URL/institution validators).
- **Multi-step wizard**: settle + advance (Save-and-Continue), stops at Review, never submits.
- **"I currently work here"** ticks for current roles so the required "To" date clears.

Known long-tail (documented, deferred): NGC **School** is a remote institution-search that returns
"No Items." for synthetic queries (real user's real school works); **education multi-entry dates**
need per-block start/end pairing.

## The honest blocker pattern for Tier-2

1. **CAPTCHA** (iCIMS hCaptcha) — cannot be automated by design; the extension still fills post-gate.
2. **Account / email gates** (Workday, Dayforce, BrassRing) — automatable via temp-email account
   creation (mail.tm); each is its own flow, ~1 session of work like Workday was.
3. **Custom-framework SPAs** (Oracle Knockout, Oracle JET) — need component-specific interaction.
4. **Link rot** (Taleo, Paycom, Dayforce-ASRC) — real job postings expire; need fresh URLs to test.

**Established mitigation (repo #342):** capture each gated form once (human passes the gate in the
desktop app), freeze it as a golden fixture, and verify the engine fills it offline — same as the
Workday My Information + SuccessFactors goldens already do.

## Test tooling built this run (`jobhakken-extension/e2e/tools/`)

- `wd-run.mjs` — Workday full-wizard runner (temp-email account, whole-application autofill, per-step report).
- `oracle-run.mjs` — Oracle email-gate scaffold (WIP).
- All use mail.tm temp inboxes; Demo mode (dummy Jordan Rivera profile); never submit.

## Live gate-capture results (2026-07-30, human-in-the-loop)

Ran `capture-run.mjs` (headed) with a human clearing each gate, then autofilled the reached form:

- **iCIMS** — human solved hCaptcha → 34-field form (in `#icims_content_iframe`) → engine fills 7 standard fields.
- **Oracle** — human did email+terms+Next → 35-field form captured → engine fills name/email/phone/country/job-title/current-job; the **address block resists** (Knockout inputs need a `change`/blur event — targeted fix pending).
- **SmartRecruiters** — in a REAL browser the one-click form loads with **no captcha to reach it** (captcha only guards final submit; the earlier block was headless bot-detection) → engine fills 6/13. Effectively works for real users.

Raw captures kept out of the repo (may embed session tokens); scrub before promoting to golden fixtures.
