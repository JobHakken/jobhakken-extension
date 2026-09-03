/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/templates/modern.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
import { Resume, ResumeRenderOptions } from '../model';
import { renderDocument } from './shared';

/**
 * "Modern" template — same Latin Modern serif, but a cleaner, airier layout:
 * left-aligned header, mixed-case section titles underlined with a full-width rule,
 * a bit more breathing room. Still ATS-friendly single-column selectable text.
 */
const MODERN_CSS = `
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page {
    width: 816px; min-height: 1056px; margin: 0 auto; padding: 48px 52px; /* ~0.5in */
    background: #fff; color: #1a1d24;
    font-family: "Latin Modern Roman", "TeX Gyre Termes", Georgia, "Times New Roman", serif;
    font-size: 12px; line-height: 1.38; text-align: left;
  }
  .page p { margin: 0; }
  .name { text-align: left; font-weight: 700; font-size: 26px; letter-spacing: -.01em; line-height: 1.1; color: #10131a; }
  .contact { text-align: left; color: #3a4658; font-size: 11px; margin-top: 3px; }
  .contact a { color: #004F9F; text-decoration: none; }
  .sep { padding: 0 .4em; color: #b7c0cc; }
  .rule { display: none; } /* modern uses per-section rules instead of a header rule */
  .section-title {
    color: #004F9F; font-weight: 700; font-size: 12.5px; letter-spacing: .06em; text-transform: uppercase;
    margin: 14px 0 5px; padding-bottom: 3px; border-bottom: 1px solid #d7dde5;
  }
  .entry { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; margin-top: 6px; }
  .entry .date { font-size: 11px; white-space: nowrap; color: #667; }
  .entry .date.it { font-style: italic; }
  .small { font-size: 11px; }
  ul { margin: 3px 0 0; padding-left: 16px; list-style: disc; font-size: 11px; }
  ul li { margin: 1px 0; padding: 0; }
  ul li::marker { color: #004F9F; }
  .entrygap { height: 5px; }
  .pub { margin-top: 6px; }
`;

export function renderModern(resume: Resume, opts?: ResumeRenderOptions): string {
  return renderDocument(MODERN_CSS, resume, opts);
}
