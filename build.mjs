import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'fs';
import path from 'path';

// Build the MV3 extension into dist/ (loadable unpacked). esbuild bundles the TS
// entry points; static assets (manifest, options html, icons) are copied over.
const outdir = 'dist';
rmSync(outdir, { recursive: true, force: true });

// Service worker (module) + options page → ESM.
await esbuild.build({
  entryPoints: {
    'background/serviceWorker': 'src/background/serviceWorker.ts',
    'options/options': 'src/options/options.ts',
  },
  outdir,
  bundle: true,
  format: 'esm',
  target: 'es2020',
  logLevel: 'info',
});

// Content script → IIFE (content scripts don't support ESM imports).
await esbuild.build({
  entryPoints: { 'content/content': 'src/content/content.ts' },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'es2020',
  logLevel: 'info',
});

mkdirSync(path.join(outdir, 'options'), { recursive: true });
cpSync('src/manifest.json', path.join(outdir, 'manifest.json'));
cpSync('src/options/options.html', path.join(outdir, 'options', 'options.html'));

console.log('extension built → apps/extension/dist (load unpacked)');
