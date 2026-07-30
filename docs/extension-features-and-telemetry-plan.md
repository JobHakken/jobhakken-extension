# JobHakken Extension — features, BYO-key, and LLM-telemetry plan

_Planning doc. Written 2026-07-30. Sits under the autofill roadmap (`autofill-roadmap.md`) and must
respect ADR-0003 (local-always), ADR-0005 (cross-surface résumé), ADR-0006/0009 (E2EE sync + the BYO
LLM key inside the encrypted snapshot). Nothing here weakens the privacy promise: user content never
goes to a JobHakken server; secrets (BYO key) are client-side only, never transmitted or logged._

## A. Where the profile / AI comes from (the unifying theme)

Four requested features are all really _"where does the profile and the AI power come from?"_ — and the
answer must keep content on-device. They compose:

```
                 login (identity/entitlement)
                          │
     ┌────────────────────┼───────────────────────┐
     ▼                    ▼                        ▼
 AI résumé-input     multiple résumés        BYO-key resolution
 (parse → profile)   (pick per job)          (fetch, don't re-enter)
     └──────────── all feed → autofill + AI-fill ───────────┘
```

## B. BYO-key resolution (the growth feature)

Goal: a signed-in user's **own LLM key powers the extension's AI on any tier, for free, privately** —
and they never re-enter it because it's already in the desktop app / encrypted snapshot (ADR-0009).

**Resolution ladder (priority order) for any extension AI call:**

1. **Desktop connected → delegate the call to the desktop.** The key never leaves the app; the
   extension sends the question, the app calls the provider. Safest; uses today's bridge.
2. **Desktop closed, signed-in, BYO key in the decrypted snapshot → use it directly**, call goes
   **straight to the provider**, never through us. This is the standalone win (works with the app off).
3. **Paid tier, no BYO key → managed AI proxy** (we pay, metered `ai_usage`). BYO still allowed here.
4. **Nothing available → prompt** ("Add your AI key or connect the app").

**Per tier:** Free = BYO key (or none). Plus/Pro/Max = managed proxy by default, BYO optional. BYO tier
= own key always. → BYO key = full AI in the extension at zero cost to us (the viral hook).

**Security (ADR-0009 secrets rule — non-negotiable):**

- Prefer **delegate-to-desktop** so the key never enters the extension.
- When the extension must hold it (standalone), store in **`chrome.storage.session`** (memory-only,
  wiped on browser close) — never `.local`; re-derive from the snapshot each session. MV3 storage is
  not a vault, so minimize persistence.
- Provider call is **direct from the extension** (host_permission for the provider host); key +
  content never transit a JobHakken server or log.
- **BYO calls emit ZERO telemetry** — no `ai_usage` row, nothing. Consistent with §C.
- Gated behind login + snapshot-decrypt; this is the new security surface ADR-0009 flags.

## C. LLM token telemetry (billing ≠ quota ≠ analytics — keep them separate)

**Layer 1 — Authoritative metering (billing/quota truth).** Every _managed_ call goes through the edge
proxy; the proxy reads the provider's **actual `usage`** (never estimate client-side) and writes one
`ai_usage` row: `user_id, model, prompt_tokens, completion_tokens, cost_usd, call_type, surface,
created_at`. Tamper-proof: the client can't see the count or write the row. Quota checked **before** the
call, row written **after**. Content never stored. (This is exactly what issue #356 must lock down.)

**Layer 2 — Attribution dimensions** (so numbers mean something): `call_type` (ai_fill / resume_parse /
cover_letter / match_score), `surface` (extension / app / web), `tier`. Drives product + pricing.

**Layer 3 — Live quota UX**: client reads an aggregate ("6 of 50 AI drafts this month"), shown in the
popup — a soft cap with a graceful "upgrade for more", not a hard failure. Telemetry as visible value.

**Layer 4 — Product analytics** (opt-out, metadata-only): latency, success/error, token _buckets_ (not
exact), feature funnel → first-party sink. Never content, never PII.

**Cross-cutting decisions:**

- **BYOK = zero telemetry by design** (own key → direct call → never touches us).
- **Quota unit = requests** (predictable for users) + store tokens (real cost/margin). Essays vary 10×
  in tokens, so a pure-token cap confuses users.
- **Estimate-before / reconcile-after**: pre-check a conservative estimate, reconcile with real `usage`
  post-call.
- **AI-fill batch** (the "Draft answers" action fires ≤6 calls): meter per call (real cost), but _show_
  the user one action ("drafted 6 answers").
- **Anomaly signal**: requests/hour per user → abuse + quota-bypass detection (feeds #356).

## D. The four product features

1. **Organic review prompt** — a one-line dismissible banner in the popup after a _successful,
   meaningful_ autofill (≥~8 fields + résumé, on the 2nd–3rd success), linking to
   `/detail/{id}/reviews`. Once per user, ever. Purely local (count in storage). High ROI, low risk.
2. **Multiple résumés** — the profile store holds N résumé docs (each → its own derived profile + its
   own attachable file); popup picker "Fill with: [Backend ▾]". Needs a `@jobhakken/core` schema bump
   (one→many, cross-surface). Killer add-on: auto-suggest the best-fit résumé per JD (keyword/AI match).
3. **Login sync** — split by purpose: **auth** (identity/entitlement/AI-quota — small, reuses checkout
   auth) vs **snapshot-sync** (pull the E2EE snapshot so the extension works with the desktop off —
   the deferred standalone-extension step). Don't let "login" become "we store your résumé".
4. **AI résumé-input** — paste/upload a résumé in the extension → LLM parses it to the structured
   profile, stored **locally** → autofill works without the desktop. Highest leverage (removes the
   desktop dependency for core value). Reuses the same AI path as AI-fill.

## E. Sequencing (lowest-risk value first, growth features after the gate)

1. **Delegate-to-desktop AI** (BYO ladder step 1) — smallest/safest; extension AI whenever the app is open.
2. **Login (identity)** — the prerequisite gate for everything below.
3. **AI résumé-input** + **review prompt** — local, high-value, extension-mostly.
4. **Snapshot-decrypt → fetch BYO key (standalone)** — the "works with app off, free, own key" hook.
5. **Managed proxy + telemetry Layers 1–3** — land _with_ #356 hardening (same seam).
6. **Multiple résumés** + full snapshot sync — cross-surface schema work.

## F. Before any of this — prove the current autofill works (visual pass)

Ship confidence first: run the extension across a broad, current set of live jobs (5 per ATS) and
capture a screenshot of each filled form as visual proof. Sourcing prompt + harness described
separately. Only after the visual pass do we start the development above.
