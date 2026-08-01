import type { H1bDetail } from './h1bTypes.js';

/**
 * Merge a company's exact + word-prefix rows from the compact H-1B roles list into one insights
 * summary. `names` (sorted) and `rest` are parallel arrays parsed from `data/h1b-roles.txt`
 * (`name \t cases \t median \t wMin \t wMax \t "role:cases;role:cases"`). Word-prefix summing mirrors
 * the sponsor-badge lookup, so a brand aggregates across its legal entities
 * (e.g. "amazon" → "amazon com services" + "amazon web services" + …). Returns null when unknown.
 */
export function mergeH1bRows(names: string[], rest: string[], query: string): H1bDetail | null {
  if (!names.length || names.length !== rest.length || !query) return null;
  let lo = 0;
  let hi = names.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (names[mid] < query) lo = mid + 1;
    else hi = mid;
  }
  let filings = 0;
  let wSum = 0;
  let wCases = 0;
  let wMin = Infinity;
  let wMax = 0;
  const roles = new Map<string, number>();
  for (let i = lo; i < names.length; i++) {
    const n = names[i];
    if (!n.startsWith(query)) break;
    if (n.length !== query.length && n[query.length] !== ' ') continue; // word boundary only
    const cols = rest[i].split('\t'); // cases, median, wMin, wMax, "role:cases;role:cases"
    const cases = Number(cols[0]) || 0;
    const median = Number(cols[1]) || 0;
    const cMin = Number(cols[2]) || 0;
    const cMax = Number(cols[3]) || 0;
    filings += cases;
    if (median > 0 && cases > 0) {
      wSum += median * cases;
      wCases += cases;
    }
    if (cMin > 0) wMin = Math.min(wMin, cMin);
    if (cMax > 0) wMax = Math.max(wMax, cMax);
    for (const pair of (cols[4] || '').split(';')) {
      const c = pair.lastIndexOf(':');
      if (c < 0) continue;
      const title = pair.slice(0, c);
      const rc = Number(pair.slice(c + 1)) || 0;
      if (title && rc) roles.set(title, (roles.get(title) || 0) + rc);
    }
  }
  if (filings < 1) return null;
  return {
    company: query,
    filings,
    wageMedian: wCases ? Math.round(wSum / wCases / 1000) * 1000 : 0,
    wageMin: Number.isFinite(wMin) ? wMin : 0,
    wageMax: wMax,
    roles: [...roles.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([title, f]) => ({ title, filings: f })),
  };
}
