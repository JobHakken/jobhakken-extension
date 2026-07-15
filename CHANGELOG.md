# First2Apply extension — changelog

Version shown in the on-page panel header and Options footer (`chrome.runtime.getManifest().version`).

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
