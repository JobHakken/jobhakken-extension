/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/registry.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
import { ResumeRenderOptions, ResumeTemplate } from './model';
import { renderClassic } from './templates/classic';
import { renderClassicMono } from './templates/classic-mono';
import { renderCompact } from './templates/compact';
import { renderMinimal } from './templates/minimal';
import { renderModern } from './templates/modern';

/**
 * Available résumé templates. The picker in Résumé Studio renders each via `render`
 * for its preview, and the main process renders the selected one to PDF.
 */
export const RESUME_TEMPLATES: ResumeTemplate[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Latin Modern serif with blue section headers — the traditional academic look (from resume-template.tex).',
    render: renderClassic,
  },
  {
    id: 'classic-mono',
    name: 'Classic Mono',
    description: 'Classic layout in pure black-and-white — no color accents, safest for printing and ATS parsers.',
    render: renderClassicMono,
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Cleaner, airier layout — left-aligned header, underlined section titles, more breathing room.',
    render: renderModern,
  },
  {
    id: 'compact',
    name: 'Compact',
    description: 'Denser type + tighter margins to fit a longer history onto one page.',
    render: renderCompact,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean modern sans-serif with generous whitespace and quiet neutral-gray section labels.',
    render: renderMinimal,
  },
];

export const DEFAULT_TEMPLATE_ID = 'classic';

/** Look up a template by id, falling back to the default. */
export function getResumeTemplate(id: string | undefined): ResumeTemplate {
  return RESUME_TEMPLATES.find((t) => t.id === id) ?? RESUME_TEMPLATES[0];
}

/** Render a résumé to a full HTML document using the given template id + options. */
export function renderResumeHtml(
  resume: Parameters<ResumeTemplate['render']>[0],
  templateId: string | undefined,
  opts?: ResumeRenderOptions,
): string {
  return getResumeTemplate(templateId).render(resume, opts);
}
