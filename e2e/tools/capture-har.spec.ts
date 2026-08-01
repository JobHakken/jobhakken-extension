/**
 * Tier-2 capture tool (plan §3) — freeze a real page into a replayable HAR.
 *
 * Records the network of a live application page (with JS intact) so it can later be REPLAYED
 * offline and deterministically by e2e/replay.spec.ts. Use this for SPA / login-gated ATS pages
 * that the static-DOM fixtures can't represent (Workday/iCIMS re-render behaviour).
 *
 * Gated behind CAPTURE=1 so it never runs in the normal suite. Loads in Demo mode (dummy data),
 * fill-only, never submits.
 *
 *   CAPTURE=1 CAPTURE_URL="https://jobs.lever.co/acme/<id>/apply" CAPTURE_NAME=lever-acme npm run capture:har
 *
 * Writes e2e/har/<name>.har + e2e/har/<name>.json (the sidecar the replay test reads for the URL).
 * NOTE: captured pages are third-party content — keep this repo private and minimise what you commit.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium, test } from '@playwright/test';

import { installNoSubmit } from '../support/noSubmit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '../../dist');
const HAR_DIR = path.resolve(__dirname, '../har');

test('capture a HAR', async () => {
  test.skip(!process.env.CAPTURE, 'discovery tool — set CAPTURE=1 CAPTURE_URL=<url> CAPTURE_NAME=<name>');
  const url = process.env.CAPTURE_URL;
  const name = process.env.CAPTURE_NAME;
  test.skip(!url || !name, 'CAPTURE_URL and CAPTURE_NAME are required');

  if (!existsSync(HAR_DIR)) mkdirSync(HAR_DIR, { recursive: true });
  const harPath = path.join(HAR_DIR, `${name}.har`);

  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
    recordHar: { path: harPath, mode: 'minimal', content: 'embed' },
  });
  try {
    await installNoSubmit(ctx); // mechanical: capture is fill/browse-only, never submit
    const page = await ctx.newPage();
    await page.goto(url as string, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3500); // let the SPA settle so its subresources land in the HAR
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- name is a developer CLI arg
    writeFileSync(path.join(HAR_DIR, `${name}.json`), JSON.stringify({ name, url }, null, 2));
  } finally {
    await ctx.close(); // flushes the HAR to disk
  }
  console.log(
    `\ncaptured → ${harPath}\n  review + minimise before committing (third-party content, private repo only).`,
  );
});
