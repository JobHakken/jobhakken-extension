/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/templates/minimal.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
import { Resume, ResumeRenderOptions } from '../model';
import { renderDocument } from './shared';

/**
 * "Minimal" template — a clean, contemporary sans-serif take: left-aligned header,
 * generous whitespace, thin letter-spaced small-caps section labels with no heavy
 * rules, and a subtle neutral-gray palette (no bright accent). Single-column,
 * selectable text — still ATS-friendly, just quieter and more modern than Classic.
 */
const MINIMAL_CSS = `
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page {
    width: 816px; min-height: 1056px; margin: 0 auto; padding: 52px 56px; /* ~0.55in */
    background: #fff; color: #2b2f36;
    font-family: "Helvetica Neue", Helvetica, Arial, "Segoe UI", system-ui, sans-serif;
    font-size: 11.5px; line-height: 1.45; text-align: left;
  }
  .page p { margin: 0; }
  .name { text-align: left; font-weight: 600; font-size: 25px; letter-spacing: .01em; line-height: 1.1; color: #16181d; }
  .contact { text-align: left; color: #6b727c; font-size: 10.5px; margin-top: 4px; letter-spacing: .01em; }
  .contact a { color: #2b2f36; text-decoration: none; }
  .sep { padding: 0 .45em; color: #c3c9d0; }
  .rule { display: none; }
  .section-title {
    color: #6b727c; font-weight: 600; font-size: 10px; letter-spacing: .18em; text-transform: uppercase;
    margin: 18px 0 6px;
  }
  .entry { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-top: 7px; }
  .entry .date { font-size: 10px; white-space: nowrap; color: #8a8f98; }
  .entry .date.it { font-style: italic; }
  .small { font-size: 10.5px; }
  ul { margin: 3px 0 0; padding-left: 15px; list-style: disc; font-size: 10.5px; }
  ul li { margin: 1.5px 0; padding: 0; }
  ul li::marker { color: #b6bcc4; }
  .entrygap { height: 6px; }
  .pub { margin-top: 6px; }
`;

export function renderMinimal(resume: Resume, opts?: ResumeRenderOptions): string {
  return renderDocument(MINIMAL_CSS, resume, opts);
}
