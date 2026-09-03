/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/model.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
/**
 * Résumé model (Phase 3R). The canonical shape is the **Reactive Resume v5**
 * `ResumeData` (vendored, MIT — see ./schema). Both render engines consume it:
 *  - `html`      → our HTML/CSS templates → Chromium printToPDF (this slice)
 *  - `react-pdf` → RR's @react-pdf/renderer templates (Slice 3R-3)
 *
 * Descriptions/bullets are **rich-text HTML strings** (`<p>`, `<ul><li>`,
 * `<strong>`, `<a>`) — that's where bullet points come from. The HTML templates
 * sanitize + inject them (see ./templates/shared). Job-Ops (also RR v5) imports
 * via ./fromReactiveResumeV5 (now a validate/near-identity).
 */
import type { ResumeData } from './schema';

/**
 * Version of the shared résumé data schema (ADR-0005). Every cross-surface export of a résumé — the
 * app↔extension bridge payload, the web↔app export/import JSON — carries this so the receiver can
 * validate/migrate rather than guess. The canonical shape is Reactive Resume **v5** (see ./schema);
 * bump this only when that shape changes in a way consumers must react to.
 */
export const RESUME_SCHEMA_VERSION = 5;

/** Back-compat alias — the résumé model is the Reactive Resume v5 `ResumeData`. */
export type Resume = ResumeData;

/** Page size for the résumé (drives @page size + the on-screen page dimensions). */
export type ResumePageSize = 'Letter' | 'A4';

/** Which rendering engine a template uses. */
export type ResumeEngine = 'html' | 'react-pdf';

/** Render-time options shared by templates, the preview, and the PDF exporter. */
export type ResumeRenderOptions = {
  pageSize?: ResumePageSize; // default 'Letter'
};

/**
 * A selectable résumé template. `html` templates render a `Resume` to a
 * self-contained HTML document (via `render`); `react-pdf` templates are rendered
 * by the react-pdf engine instead (Slice 3R-3) and leave `render` unused.
 */
export type ResumeTemplate = {
  id: string;
  name: string;
  description: string;
  engine?: ResumeEngine; // default 'html'
  render: (resume: Resume, opts?: ResumeRenderOptions) => string;
};

/** The user's chosen template + page size + their résumé (what we persist locally). */
export type ResumeDoc = {
  resume: Resume;
  templateId: string;
  pageSize?: ResumePageSize;
};
