/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/fonts.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
/**
 * `@font-face` CSS for the résumé templates, injected into every template so the
 * renderer's live preview and the main-process printToPDF use the SAME fonts
 * (fidelity: preview == export). Single source of truth.
 *
 * Slice 3a (core): returns '' — templates fall back to the system serif stack
 * (Georgia/Times), which already looks close to Latin Modern. Slice 3a (renderer)
 * fills this with base64 `data:`-URI @font-face rules for a Latin Modern subset so
 * exported PDFs are pixel-consistent on any OS without shipping a native binary.
 */
export function resumeFontFaceCss(): string {
  return '';
}
