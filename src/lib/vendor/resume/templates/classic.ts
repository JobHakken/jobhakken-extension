/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/templates/classic.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
import { Resume, ResumeRenderOptions } from '../model';
import { renderDocument } from './shared';

/**
 * "Classic" template — a faithful reproduction of the user's resume-template.tex
 * (Latin Modern serif, #004F9F section blue, centered header + rule, uppercase bold
 * blue sections, ragged-right compact body, tight bullets, right-aligned dates).
 */
const CLASSIC_CSS = `
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page {
    width: 816px; min-height: 1056px; margin: 0 auto; padding: 43.2px; /* 0.45in */
    background: #fff; color: #000;
    font-family: "Latin Modern Roman", "CMU Serif", "TeX Gyre Termes", Georgia, "Times New Roman", serif;
    font-size: 12px; line-height: 1.28; text-align: left;
  }
  .page p { margin: 0; }
  .name { text-align: center; font-weight: 700; font-size: 29.3px; letter-spacing: .3px; line-height: 1.1; }
  .contact { text-align: center; color: #004F9F; font-size: 12px; margin-top: 2px; }
  .contact a { color: #004F9F; text-decoration: none; }
  .sep { padding: 0 .28em; }
  .rule { border: none; border-top: .8px solid #000; margin: 6px 0 0; }
  .section-title { color: #004F9F; font-weight: 700; font-size: 16px; text-transform: uppercase; letter-spacing: .04em; margin: 7px 0 2px; }
  .entry { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; margin-top: 3px; }
  .entry .date { font-size: 11px; white-space: nowrap; }
  .entry .date.it { font-style: italic; }
  .small { font-size: 11px; }
  ul { margin: 1px 0 0; padding-left: 15px; list-style: disc; font-size: 11px; }
  ul li { margin: 0; padding: 0; }
  .entrygap { height: 2px; }
  .pub { margin-top: 4px; }
`;

export function renderClassic(resume: Resume, opts?: ResumeRenderOptions): string {
  return renderDocument(CLASSIC_CSS, resume, opts);
}
