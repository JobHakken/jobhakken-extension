/**
 * Static-fixture capture tool (Tier-1) — freeze a real application FORM into a committed HTML fixture.
 *
 * Loads a live public form, finds the subtree with the most fillable fields, and saves JUST that
 * subtree wrapped in a minimal HTML doc (minimise third-party content — private repo only). The
 * result is served locally and drives a golden coverage test, exactly like greenhouse.samsung.html.
 *
 * Gated behind CAPTURE=1. Fill/browse-only, never submits.
 *   CAPTURE=1 CAPTURE_URL="https://jobs.lever.co/acme/<id>/apply" CAPTURE_NAME=lever-acme npm run capture:static
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium, test } from '@playwright/test';

import { installNoSubmit } from '../support/noSubmit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '../../dist');
const FIX_DIR = path.resolve(__dirname, '../fixtures');

test('capture a static form fixture', async () => {
  test.skip(!process.env.CAPTURE, 'discovery tool — set CAPTURE=1 CAPTURE_URL=<url> CAPTURE_NAME=<name>');
  const url = process.env.CAPTURE_URL;
  const name = process.env.CAPTURE_NAME;
  test.skip(!url || !name, 'CAPTURE_URL and CAPTURE_NAME are required');

  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  try {
    await installNoSubmit(ctx);
    const page = await ctx.newPage();
    await page.goto(url as string, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // SPAs render the form client-side — wait for a real field, not a fixed sleep.
    const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
    await page.waitForSelector(FIELD, { timeout: 20_000 }).catch(() => {});
    // Some ATS gate the form behind an "Apply" / "I'm interested" button — click it, then wait again.
    if (
      (await page
        .locator(FIELD)
        .count()
        .catch(() => 0)) < 3
    ) {
      const apply = page
        .getByRole('button', { name: /apply|i'?m interested|start application/i })
        .or(page.getByRole('link', { name: /apply/i }))
        .first();
      if (await apply.count().catch(() => 0)) {
        await apply.click({ timeout: 5000 }).catch(() => {});
        await page.waitForSelector(FIELD, { timeout: 15_000 }).catch(() => {});
      }
    }
    await page.waitForTimeout(1500);

    // The form may be in the main frame OR an iframe (e.g. BambooHR) — pick the frame with the most fields.
    let target = page.mainFrame();
    let bestFrameCount = -1;
    for (const fr of page.frames()) {
      const n = await fr
        .locator(FIELD)
        .count()
        .catch(() => 0);
      if (n > bestFrameCount) {
        bestFrameCount = n;
        target = fr;
      }
    }

    // Extract the subtree containing the most fillable fields (the application form), minified into a
    // standalone doc. Strips scripts. Keeps structure/labels/inputs the content script detects.
    const html: string = await target.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('form, section, div, main'));
      let best: Element | null = null;
      let bestCount = 0;
      for (const el of candidates) {
        const n = el.querySelectorAll('input:not([type=hidden]), select, textarea').length;
        if (n > bestCount) {
          bestCount = n;
          best = el;
        }
      }
      const root = (best ?? document.body).cloneNode(true) as HTMLElement;
      root.querySelectorAll('script, noscript, iframe, svg').forEach((n) => n.remove());
      return `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${document.title.replace(/[<>]/g, '')}</title></head>\n<body>\n${root.outerHTML}\n</body>\n</html>\n`;
    });

    if (!existsSync(FIX_DIR)) mkdirSync(FIX_DIR, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- name is a developer CLI arg
    writeFileSync(path.join(FIX_DIR, `${name}.html`), html);
    console.log(
      `\ncaptured → e2e/fixtures/${name}.html (${(html.length / 1024).toFixed(0)} KB) — review + scrub before committing.`,
    );
  } finally {
    await ctx.close();
  }
});
