/**
 * Regenerate the extension's compact per-company H-1B *insights* summary from the source roles CSV.
 * Output: src/data/h1b-roles.txt — one line per company, TAB-separated, SORTED by normalized name
 * (so the service worker can binary-search it just like h1b-sponsors.txt):
 *
 *   normalizedName \t totalCases \t wageMedian \t wageMin \t wageMax \t role1:cases1;role2:cases2;role3:cases3
 *
 * Powers the collapsible "H-1B history" panel at the bottom of the toolbar popup (issue #92): for the
 * company on the current job page we show total filings, a typical wage + range, and the top roles.
 *
 * Source CSV columns (h1b-sponsor-roles.csv, ~15 MB, lives in the backend, not this repo):
 *   normalized_name,employer,soc_code,soc_title,top_title,cases,new_employment,wage_min,wage_median,wage_max,wage_level
 * Pass its path:
 *   node scripts/gen-h1b-roles.mjs /path/to/h1b-sponsor-roles.csv
 *   H1B_ROLES_CSV=/path/to/h1b-sponsor-roles.csv node scripts/gen-h1b-roles.mjs
 * (In the monorepo checkout it's apps/backend/supabase/data/h1b-sponsor-roles.csv.)
 */
import { readFileSync, writeFileSync } from 'fs';

const CSV = process.argv[2] || process.env.H1B_ROLES_CSV;
const OUT = 'src/data/h1b-roles.txt';
if (!CSV) {
  console.error('Usage: node scripts/gen-h1b-roles.mjs <path-to-h1b-sponsor-roles.csv>  (or set H1B_ROLES_CSV)');
  process.exit(1);
}

/** quote-aware CSV split (employer names + role titles contain commas) */
function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (s) => {
  const n = Number(String(s ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const lines = readFileSync(CSV, 'utf-8').split(/\r?\n/);
/** norm -> { cases, wSum, wCases, wMin, wMax, roles: Map<socTitle, cases> } */
const byCo = new Map();
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = parseLine(lines[i]);
  const norm = (c[0] || '').trim();
  if (!norm) continue;
  const cases = num(c[5]);
  const median = num(c[8]);
  const wMin = num(c[7]);
  const wMax = num(c[9]);
  const role = (c[3] || '').trim(); // soc_title = standardized, human-readable role
  const e = byCo.get(norm) ?? { cases: 0, wSum: 0, wCases: 0, wMin: Infinity, wMax: 0, roles: new Map() };
  e.cases += cases;
  if (median > 0 && cases > 0) {
    e.wSum += median * cases; // case-weighted → a "typical" wage, not median-of-medians
    e.wCases += cases;
  }
  if (wMin > 0) e.wMin = Math.min(e.wMin, wMin);
  if (wMax > 0) e.wMax = Math.max(e.wMax, wMax);
  if (role) e.roles.set(role, (e.roles.get(role) || 0) + cases);
  byCo.set(norm, e);
}

const clean = (s) =>
  s
    .replace(/[;:|\t\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const rows = [];
for (const [norm, e] of byCo) {
  if (e.cases < 1) continue;
  const median = e.wCases ? Math.round(e.wSum / e.wCases / 1000) * 1000 : 0;
  const wMin = Number.isFinite(e.wMin) ? e.wMin : 0;
  const topRoles = [...e.roles.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${clean(t)}:${n}`)
    .join(';');
  rows.push([norm, `${e.cases}\t${median}\t${wMin}\t${e.wMax}\t${topRoles}`]);
}
rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
writeFileSync(OUT, rows.map(([n, rest]) => `${n}\t${rest}`).join('\n') + '\n');
const bytes = readFileSync(OUT).length;
console.log(`wrote ${OUT}: ${rows.length} companies, ${(bytes / 1048576).toFixed(2)} MB`);
