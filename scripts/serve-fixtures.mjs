import { createServer } from 'http';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Serve real ATS application pages over http://127.0.0.1:8787 so you can open one in
// the browser and eyeball the live extension on it (the content script matches http://*,
// so no file-URL permission is needed). Pure Node built-ins, no deps.
//
// Prefers the raw, full "Save page as" captures (full_website/ — kept locally, gitignored)
// because they render with their original CSS; falls back to the clean extracted fixtures
// (committed under e2e/fixtures) when the raw captures aren't present.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'full_website');
const FIXTURES = path.join(ROOT, 'e2e', 'fixtures');
// F2A_FIXTURES_ONLY forces the committed fixtures (reproducible E2E); otherwise prefer
// the local raw captures when present (nicer for eyeballing with real CSS).
const DIR = process.env.F2A_FIXTURES_ONLY ? FIXTURES : existsSync(RAW) ? RAW : FIXTURES;
const PORT = 8787;

/** All .html files under `dir`, as paths relative to `dir`. */
function listHtml(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listHtml(full, base));
    else if (entry.endsWith('.html')) out.push(path.relative(base, full));
  }
  return out;
}

createServer((req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').replace(/^\//, '').split('?')[0]);
  if (!rel) {
    const files = listHtml(DIR).sort();
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<h1>JobHakken — real ATS pages</h1><p>Serving <code>${path.relative(ROOT, DIR)}</code></p><ul>${files
        .map((f) => `<li><a href="/${encodeURI(f)}">${f}</a></li>`)
        .join('')}</ul>`,
    );
    return;
  }
  // constrain to DIR (no path traversal)
  const target = path.normalize(path.join(DIR, rel));
  if (!target.startsWith(DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const html = readFileSync(target, 'utf-8'); // read BEFORE sending headers
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Real ATS pages on http://127.0.0.1:${PORT}  (serving ${path.relative(ROOT, DIR)}; Ctrl+C to stop)`));
