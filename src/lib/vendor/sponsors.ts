/**
 * VENDORED from @jobhakken/core (libraries/core/src/sponsors.ts), 2026-08-19 — see src/lib/vendor/llm/types.ts for why.
 */

// Legal-entity suffixes stripped when normalizing a company name for H-1B sponsor
// matching. MUST stay in sync with the loader that built h1b_sponsors.normalized_name.
const COMPANY_SUFFIXES = new Set([
  'inc',
  'llc',
  'ltd',
  'corp',
  'corporation',
  'co',
  'company',
  'llp',
  'plc',
  'limited',
  'incorporated',
  'group',
  'holdings',
  'gmbh',
  'lp',
  'pllc',
  'pc',
  'na',
  'usa',
]);

/**
 * Normalize a company name for sponsor matching: lowercase, strip punctuation, and
 * drop trailing legal-entity suffixes ("Google LLC" -> "google").
 */
export function normalizeCompanyName(name: string): string {
  const s = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const toks = s.split(' ').filter(Boolean);
  while (toks.length && COMPANY_SUFFIXES.has(toks[toks.length - 1])) toks.pop();
  return toks.join(' ');
}

/**
 * Trigram (Jaccard) similarity in 0-1, mirroring Postgres `pg_trgm.similarity` closely
 * enough to rank/threshold. Used locally to score how well a job title matches an
 * H-1B SOC/role title (replacing the pg RPC's `similarity()` in local mode).
 */
export function trigramSimilarity(a: string, b: string): number {
  const trigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    const words = (s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const w of words) {
      const padded = `  ${w} `;
      for (let i = 0; i < padded.length - 2; i += 1) set.add(padded.slice(i, i + 3));
    }
    return set;
  };
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

// H1bSponsorMatch and H1bRoleMatch now live in types.ts so the Deno edge runtime's
// module graph doesn't need an extensionless cross-module import here.
