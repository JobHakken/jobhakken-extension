/**
 * Shared bits for building a prefilled `github.com/…/issues/new` draft — the popup's "Report this
 * page" flow and the rail's `reportUnknownSite()` both open one, and both need the same fix for the
 * same problem (0.41.2): GitHub treats two issues with an identical title as a likely duplicate, and
 * a title built from just "reason + company" collided across different postings on the same site.
 *
 * `pageRef` is DETERMINISTIC on origin + path (query stripped — LinkedIn and Greenhouse both hang
 * tracking ids off their URLs, which would make one posting look like several). So reporting the SAME
 * page twice still collides — a real duplicate, which should look like one — while two different
 * postings never do. Nothing here calls the GitHub API: this only builds a URL the browser navigates
 * to, and the user still has to review and click Submit on GitHub's own page for anything to be
 * created — see `docs/store-listing.md`'s "Broad host permissions" section for why that distinction
 * matters for the store's data-use disclosure.
 */
export const ISSUES_REPO = 'https://github.com/JobHakken/JobHakken-issues';

export function pageRef(u: string): string {
  let clean = u;
  try {
    const parsed = new URL(u);
    clean = parsed.origin + parsed.pathname;
  } catch {
    /* not a parseable URL — hash whatever we were given */
  }
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = (Math.imul(31, h) + clean.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 5);
}

export function issueUrl(title: string, body: string, labels: string[]): string {
  const params = new URLSearchParams({ title, body });
  for (const l of labels) params.append('labels', l);
  return `${ISSUES_REPO}/issues/new?${params.toString()}`;
}
