/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/schema/index.ts (trimmed: analysis/sample/section-icons/style-rules/level-display-sizes dropped — unused by data/default/templates, confirmed by grep)), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
/**
 * Reactive Resume v5 résumé schema (vendored, MIT — see REACTIVE-RESUME-LICENSE).
 * The canonical résumé data model for the Résumé Studio (both the HTML/Chromium and
 * the react-pdf engines consume this). Pointed at `zod/v4` (available via the
 * repo's zod 3.25 without a repo-wide bump). Kept OUT of the Deno/edge graph.
 */
export * from './templates';
export * from './data';
export * from './default';
