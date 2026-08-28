/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/templates/classic-mono.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
import { Resume, ResumeRenderOptions } from '../model';
import { renderDocument } from './shared';

/**
 * "Classic Mono" template — the Classic layout stripped to pure black-and-white:
 * no blue (or any) color accents, black links and section headers, black bullet
 * markers. Prints cleanly on any printer and is the safest choice for ATS parsers
 * that choke on color. Same serif, centered header, uppercase sections as Classic.
 */
const CLASSIC_MONO_CSS = `
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
  .name { text-align: center; font-weight: 700; font-size: 29.3px; letter-spacing: .3px; line-height: 1.1; color: #000; }
  .contact { text-align: center; color: #000; font-size: 12px; margin-top: 2px; }
  .contact a { color: #000; text-decoration: none; }
  .sep { padding: 0 .28em; }
  .rule { border: none; border-top: .8px solid #000; margin: 6px 0 0; }
  .section-title { color: #000; font-weight: 700; font-size: 16px; text-transform: uppercase; letter-spacing: .04em; margin: 7px 0 2px; border-bottom: .8px solid #000; padding-bottom: 1px; }
  .entry { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; margin-top: 3px; }
  .entry .date { font-size: 11px; white-space: nowrap; }
  .entry .date.it { font-style: italic; }
  .small { font-size: 11px; }
  ul { margin: 1px 0 0; padding-left: 15px; list-style: disc; font-size: 11px; }
  ul li { margin: 0; padding: 0; }
  ul li::marker { color: #000; }
  .entrygap { height: 2px; }
  .pub { margin-top: 4px; }
`;

export function renderClassicMono(resume: Resume, opts?: ResumeRenderOptions): string {
  return renderDocument(CLASSIC_MONO_CSS, resume, opts);
}
