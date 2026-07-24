import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import sharp from 'sharp';

// Build the MV3 extension into dist/ (loadable unpacked). esbuild bundles the TS
// entry points; static assets (manifest, options html, icons) are copied over.
const outdir = 'dist';
// Prod (packaging / release): minify, no source maps. Dev (default): source maps for
// debugging, no minify. `npm run package` sets NODE_ENV=production.
const prod = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const shared = { bundle: true, target: 'es2020', logLevel: 'info', minify: prod, sourcemap: prod ? false : 'linked' };
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

// No-remote-code guarantee: the CSP for extension pages must be present and must not weaken
// script-src (no unsafe-eval / unsafe-inline / remote hosts). esbuild bundles everything locally,
// so the only way remote/eval'd code sneaks in is a loosened CSP — fail the build if so.
const csp = manifest.content_security_policy?.extension_pages ?? '';
if (!/script-src[^;]*'self'/.test(csp)) throw new Error("manifest CSP must set script-src 'self'");
if (/unsafe-eval|unsafe-inline|https?:/.test(csp))
  throw new Error(`manifest CSP weakens script-src (no eval/inline/remote): "${csp}"`);

console.log(`extension built → ${outdir}/ (${prod ? 'production, minified' : 'dev, source maps'}) — load unpacked`);
