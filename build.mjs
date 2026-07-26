import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import sharp from 'sharp';

// Build the MV3 extension into dist/ (loadable unpacked). esbuild bundles the TS
// entry points; static assets (manifest, options html, icons) are copied over.
const outdir = 'dist';
// Prod (packaging / release): minify, no source maps. Dev (default): source maps for
// debugging, no minify. `npm run package` sets NODE_ENV=production.
const prod = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
// GA_API_SECRET is injected at build time (from the repo secret in CI/publish). Absent in dev/CI
// test builds → the GA telemetry sink stays inert (nothing is sent). The measurement id is public.
const shared = {
  bundle: true,
  target: 'es2020',
  logLevel: 'info',
  minify: prod,
  sourcemap: prod ? false : 'linked',
  define: { __GA_API_SECRET__: JSON.stringify(process.env.GA_API_SECRET || '') },
};
rmSync(outdir, { recursive: true, force: true });

// Service worker (module) + options + popup pages → ESM.
await esbuild.build({
  entryPoints: {
    'background/serviceWorker': 'src/background/serviceWorker.ts',
    'options/options': 'src/options/options.ts',
    'popup/popup': 'src/popup/popup.ts',
  },
  outdir,
  format: 'esm',
  ...shared,
});

// Content script → IIFE (content scripts don't support ESM imports).
await esbuild.build({
  entryPoints: { 'content/content': 'src/content/content.ts' },
  outdir,
  format: 'iife',
  ...shared,
});

mkdirSync(path.join(outdir, 'options'), { recursive: true });
mkdirSync(path.join(outdir, 'popup'), { recursive: true });
mkdirSync(path.join(outdir, 'data'), { recursive: true });

// Toolbar + Web Store icons (16/32/48/128) are GENERATED at build time from the brand mark
// (brand/favicon.svg). Keep this SVG in sync with the website's favicon (the canonical mark)
// when the brand changes — rendering from the SVG each build means the extension always tracks
// this repo's copy of the mark instead of a stale PNG.
const BRAND_SVG = path.resolve('brand', 'favicon.svg');
mkdirSync(path.join(outdir, 'icons'), { recursive: true });
const brandSvg = readFileSync(BRAND_SVG);
for (const size of [16, 32, 48, 128]) {
  // high density so the 64-unit SVG rasterizes crisply before the downscale to `size`
  await sharp(brandSvg, { density: 512 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outdir, 'icons', `icon-${size}.png`));
}

cpSync('src/manifest.json', path.join(outdir, 'manifest.json'));

// E2E ONLY: the Playwright suite serves ATS fixtures on 127.0.0.1, but production deliberately does
// NOT match localhost in content_scripts (finding #2 — don't inject into every local app). Patch the
// dist manifest for tests so the content script injects on the fixtures. Gated on EXACTLY E2E=1 AND
// non-prod (a stray "0"/"false" must NOT fire it); a safety assert below fails any other build that
// somehow carries localhost.
const e2eBuild = process.env.E2E === '1' && !prod;
if (e2eBuild) {
  const mPath = path.join(outdir, 'manifest.json');
  const m = JSON.parse(readFileSync(mPath, 'utf8'));
  m.content_scripts[0].matches = [...new Set([...m.content_scripts[0].matches, '*://127.0.0.1/*', '*://localhost/*'])];
  writeFileSync(mPath, JSON.stringify(m, null, 2));
  console.log('  [E2E] added localhost content-script matches to dist/manifest.json (test-only)');
}
cpSync('src/data/h1b-sponsors.txt', path.join(outdir, 'data', 'h1b-sponsors.txt')); // bundled H-1B list
cpSync('src/options/options.html', path.join(outdir, 'options', 'options.html'));
cpSync('src/popup/popup.html', path.join(outdir, 'popup', 'popup.html'));

// Sanity-check the manifest we just shipped so a malformed edit fails the build,
// not the Chrome Web Store review. (Full store-compliance checks come in Phase 6.)
const manifest = JSON.parse(readFileSync(path.join(outdir, 'manifest.json'), 'utf8'));
for (const key of ['manifest_version', 'name', 'version', 'background']) {
  if (manifest[key] == null) throw new Error(`manifest.json is missing required key: ${key}`);
}
if (manifest.manifest_version !== 3) throw new Error(`expected manifest_version 3, got ${manifest.manifest_version}`);

// Safety net (finding #20): ONLY an explicit E2E dev build may carry localhost content-script matches.
// Any other build — especially prod/package — must not, else finding #2 (inject into every local app)
// is re-introduced. The permission-diff guard reads src/manifest.json and can't see a dist patch, so
// this closes that gap at the built artifact.
if (!e2eBuild) {
  const localhostMatches = (manifest.content_scripts ?? [])
    .flatMap((c) => c.matches ?? [])
    .filter((m) => /localhost|127\.0\.0\.1/.test(m));
  if (localhostMatches.length)
    throw new Error(`non-E2E build must not match localhost in content_scripts: ${localhostMatches.join(', ')}`);
}

// Version sync: manifest.version must equal package.json version (CWS rejects mismatches).
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (manifest.version !== pkgVersion)
  throw new Error(
    `version mismatch: manifest.json ${manifest.version} vs package.json ${pkgVersion} — keep them in sync`,
  );

// No-remote-code guarantee via an ALLOWLIST, not a blocklist (finding #22): parse the extension-pages
// CSP and require every script-src/object-src token to be 'self' or 'none'. This rejects `*`, bare
// hosts, data:/blob:, unsafe-eval/inline, wasm-unsafe-eval, nonces, etc. — a loosened CSP a blocklist
// regex would have missed. esbuild bundles locally, so this keeps the pages unable to load/eval remote.
const csp = manifest.content_security_policy?.extension_pages ?? '';
const cspDirectives = Object.fromEntries(
  csp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...sources] = d.split(/\s+/);
      return [name.toLowerCase(), sources];
    }),
);
const ALLOWED_CSP_SOURCES = new Set(["'self'", "'none'"]);
for (const key of ['script-src', 'object-src']) {
  const sources = cspDirectives[key];
  if (!sources || sources.length === 0) throw new Error(`manifest CSP must set ${key}`);
  const bad = sources.filter((s) => !ALLOWED_CSP_SOURCES.has(s));
  if (bad.length)
    throw new Error(`manifest CSP ${key} allows disallowed source(s): ${bad.join(' ')} (only 'self' / 'none')`);
}

console.log(`extension built → ${outdir}/ (${prod ? 'production, minified' : 'dev, source maps'}) — load unpacked`);
