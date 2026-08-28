/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/templates/compact.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
import { Resume, ResumeRenderOptions } from '../model';
import { renderDocument } from './shared';

/**
 * "Compact" template — same classic serif look but denser (tighter margins, smaller
 * type, minimal gaps) to fit more onto a single page. Good for long histories.
 */
const COMPACT_CSS = `
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page {
    width: 816px; min-height: 1056px; margin: 0 auto; padding: 33.6px; /* 0.35in */
    background: #fff; color: #000;
    font-family: "Latin Modern Roman", "CMU Serif", Georgia, "Times New Roman", serif;
    font-size: 10.5px; line-height: 1.2; text-align: left;
  }
  .page p { margin: 0; }
  .name { text-align: center; font-weight: 700; font-size: 22px; letter-spacing: .2px; line-height: 1.05; }
  .contact { text-align: center; color: #004F9F; font-size: 10px; margin-top: 1px; }
  .contact a { color: #004F9F; text-decoration: none; }
  .sep { padding: 0 .22em; }
  .rule { border: none; border-top: .7px solid #000; margin: 4px 0 0; }
  .section-title { color: #004F9F; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: .03em; margin: 5px 0 1px; }
  .entry { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-top: 2px; }
  .entry .date { font-size: 9.5px; white-space: nowrap; }
  .entry .date.it { font-style: italic; }
  .small { font-size: 9.5px; }
  ul { margin: 0; padding-left: 13px; list-style: disc; font-size: 9.5px; }
  ul li { margin: 0; padding: 0; }
  .entrygap { height: 1px; }
  .pub { margin-top: 2px; }
`;

export function renderCompact(resume: Resume, opts?: ResumeRenderOptions): string {
  return renderDocument(COMPACT_CSS, resume, opts);
}
