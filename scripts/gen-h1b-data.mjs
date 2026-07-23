/**
 * Regenerate the extension's compact H-1B sponsor list from the source CSV.
 * Output: src/data/h1b-sponsors.txt — "normalizedName\tapprovals" per line, approvals>=1,
 * exact-duplicates summed, SORTED by name (so the service worker can binary-search a name +
 * its word-prefixes, e.g. "emerson" → "emerson electric" + "emerson process …").
 *
 * The source CSV (~7.5 MB) lives in the backend, not this repo. Pass its path:
 *   node scripts/gen-h1b-data.mjs /path/to/h1b-sponsors.csv
 *   H1B_CSV=/path/to/h1b-sponsors.csv node scripts/gen-h1b-data.mjs
 * (In the monorepo checkout it's apps/backend/supabase/data/h1b-sponsors.csv.)
 */
import { readFileSync, writeFileSync } from 'fs';

const CSV = process.argv[2] || process.env.H1B_CSV;
const OUT = 'src/data/h1b-sponsors.txt';
if (!CSV) {
  console.error('Usage: node scripts/gen-h1b-data.mjs <path-to-h1b-sponsors.csv>  (or set H1B_CSV)');
  process.exit(1);
}

function parseLine(line) {
  // quote-aware split (employer names contain commas); we only need col0 + col2
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(CSV, 'utf-8').split(/\r?\n/);
const totals = new Map();
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const cols = parseLine(lines[i]);
  const norm = (cols[0] || '').trim();
  const approvals = Number(cols[2]) || 0;
  if (!norm || approvals < 1) continue;
  totals.set(norm, (totals.get(norm) || 0) + approvals);
}
const rows = [...totals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
writeFileSync(OUT, rows.map(([n, a]) => `${n}\t${a}`).join('\n') + '\n');
const bytes = readFileSync(OUT).length;
console.log(`wrote ${OUT}: ${rows.length} companies, ${(bytes / 1048576).toFixed(2)} MB`);
