/**
 * Tier-2 replay tests (plan §3) — run the extension against FROZEN real pages, offline.
 *
 * For every committed e2e/har/*.har (captured via e2e/tools/capture-har.spec.ts), replay it with
 * Playwright's routeFromHAR so the page renders deterministically from frozen network — then run
 * autofill and, if a matching golden exists (e2e/goldens/<name>.golden.json), assert it. This is
 * how SPA / login-gated ATS pages become part of the deterministic gate.
 *
 * Skips cleanly when no HARs are committed yet, so the gate stays green until the first capture.
 *
 * Replay caveat (documented so the next person doesn't fight it): live SPAs use per-request IDs that
 * won't match on replay. If routeFromHAR aborts on a legit request, add urlFilter/normalisation here
 * — do NOT switch to notFound:'fallback' in the committed suite (it silently re-introduces live network).
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { BrowserContext, chromium, expect, test as base } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '../dist');
const HAR_DIR = path.resolve(__dirname, 'har');
const GOLDEN_DIR = path.resolve(__dirname, 'goldens');

type Field = { selector: string; expect: string; match?: 'exact' | 'contains'; gate?: boolean };
type Golden = { fixture: string; fields: Field[] };

declare const chrome: {
  storage: {
    local: { set(items: Record<string, unknown>): Promise<void> };
    session: { get(key: string): Promise<Record<string, unknown>> };
  };
  tabs: {
    query(q: object): Promise<Array<{ id?: number }>>;
    sendMessage(id: number, msg: unknown, opts?: object): Promise<unknown>;
  };
};

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: ['--headless=new', `--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]);
  },
});

async function autofill(context: BrowserContext): Promise<void> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    let frameId: number | undefined;
    try {
      const key = `f2a_frames:${tab.id}`;
      // eslint-disable-next-line security/detect-object-injection -- code-built storage key, not user input
      const counts = ((await chrome.storage.session.get(key))[key] ?? {}) as Record<string, number>;
      let best = 0;
      for (const [fid, c] of Object.entries(counts)) {
        if (c > best) {
          best = c;
          frameId = Number(fid);
        }
      }
    } catch {
      /* broadcast fallback */
    }
    try {
      await chrome.tabs.sendMessage(
        tab.id,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'default' } },
        frameId != null ? { frameId } : {},
      );
    } catch {
      /* not ready — poll retries */
    }
  });
}

const hars = existsSync(HAR_DIR) ? readdirSync(HAR_DIR).filter((f) => f.endsWith('.har')) : [];

test.describe('tier-2 HAR replay', () => {
  test.skip(hars.length === 0, 'no committed HARs yet — capture one with `npm run capture:har`');

  for (const har of hars) {
    const name = har.replace(/\.har$/, '');
    test(`replay ${name}`, async ({ context, extensionId }) => {
      const meta = JSON.parse(
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- committed fixture path
        readFileSync(path.join(HAR_DIR, `${name}.json`), 'utf8'),
      ) as { url: string };

      // Serve the page entirely from the frozen HAR — no live network.
      await context.routeFromHAR(path.join(HAR_DIR, har), { notFound: 'abort' });

      const cfg = await context.newPage();
      await cfg.goto(`chrome-extension://${extensionId}/options/options.html`);
      await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
      await cfg.close();

      const page = await context.newPage();
      await page.goto(meta.url, { waitUntil: 'domcontentloaded' });

      const goldenPath = path.join(GOLDEN_DIR, `${name}.golden.json`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- committed fixture path
      if (existsSync(goldenPath)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- committed fixture path
        const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Golden;
        const anchor = golden.fields.find((f) => f.gate) ?? golden.fields[0];
        await expect
          .poll(
            async () => {
              await autofill(context);
              return page
                .locator(anchor.selector)
                .inputValue()
                .catch(() => '');
            },
            { timeout: 25_000 },
          )
          .not.toBe('');
        for (const f of golden.fields.filter((x) => x.gate)) {
          const val = (
            await page
              .locator(f.selector)
              .inputValue()
              .catch(() => '')
          ).trim();
          if (f.match === 'contains') expect(val, `gated ${f.selector}`).toContain(f.expect);
          else expect(val, `gated ${f.selector}`).toBe(f.expect);
        }
      } else {
        // No golden yet — at least prove the frozen page renders a form and the extension attaches.
        await autofill(context);
        expect(await page.locator('input, select, textarea').count()).toBeGreaterThan(0);
      }
    });
  }
});
