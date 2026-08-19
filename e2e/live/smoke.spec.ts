/**
 * Live-smoke robustness runner (Phase 1 of the dev robustness loop).
 *
 * Drives the REAL extension in real Chromium against a list of application pages in DEMO MODE
 * (dummy data), autofills FILL-ONLY (never submits), and reports an autofill coverage % per site.
 * Sites below the threshold are flagged as "capture this as a fixture" candidates.
 *
 * This is DISCOVERY, not a gate:
 *   - Skipped unless LIVE=1 (so `npm run test:e2e` stays deterministic).
 *   - Never asserts pass/fail on a live site — live pages change and flake. It only reports.
 *
 * Run against real sites (edit e2e/live/targets.json first — the URLs are templates):
 *   npm run test:live
 * Validate the runner offline against the committed fixture:
 *   LIVE=1 LIVE_TARGETS=e2e/live/targets.selftest.json npm run test:live
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { BrowserContext, chromium, test as base } from '@playwright/test';

import { installNoSubmit } from '../support/noSubmit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '../../dist');
const TARGETS_PATH = path.resolve(process.cwd(), process.env.LIVE_TARGETS ?? 'e2e/live/targets.json');

type Target = { ats: string; url: string };
type Config = { coverageThreshold?: number; targets: Target[] };
type Row = {
  ats: string;
  url: string;
  pageInputs: number;
  detected: number;
  filled: number;
  coverage: number | null;
  note: string;
};

// `chrome` is a browser-context global on extension pages / in the service worker.
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

/**
 * Ask the active tab's content script for a value (getState / autofill), via the service worker.
 * Targets the FRAME that actually holds the form (most detected fields) — the content script runs
 * in all_frames, so a bare sendMessage lands in every frame and the empty top frame's reply can win.
 * This mirrors the popup's frameStore targeting; without it, coverage on iframed ATS (iCIMS/Taleo)
 * is measured against the wrong frame and is meaningless.
 *
 * Returns a DISCRIMINATED result, not just `T | null` (#149). The old shape collapsed "no content
 * script answered" and "the content script answered, and saw nothing" into the same `null`, so every
 * report of a detection gap was ambiguous — we could not tell a real detection bug from a page the
 * script never attached to. Callers must handle `answered: false` separately.
 */
type Rpc<T> = { answered: true; value: T } | { answered: false; why: 'no-tab' | 'no-script' };

async function rpc<T>(context: BrowserContext, method: string, params: unknown = {}): Promise<Rpc<T>> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  return (await sw.evaluate(
    async ({ method, params }) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { answered: false, why: 'no-tab' };
      // Pick the form frame the same way frameStore does: highest fillable-field count for this tab.
      let frameId: number | undefined;
      try {
        const key = `f2a_frames:${tab.id}`;
        // eslint-disable-next-line security/detect-object-injection -- key is a code-built storage key, not user input
        const counts = ((await chrome.storage.session.get(key))[key] ?? {}) as Record<string, number>;
        let best = 0;
        for (const [fid, c] of Object.entries(counts)) {
          if (c > best) {
            best = c;
            frameId = Number(fid);
          }
        }
      } catch {
        /* no recorded frames yet — fall back to broadcast */
      }
      try {
        const opts = frameId != null ? { frameId } : {};
        const value = await chrome.tabs.sendMessage(tab.id, { type: 'f2a-rpc', method, params }, opts);
        return { answered: true, value };
      } catch {
        // Nothing received the message: the script did not match, has not attached yet, or was
        // orphaned by an extension reload (#150). NOT the same as "it looked and found nothing".
        return { answered: false, why: 'no-script' };
      }
    },
    { method, params },
  )) as Rpc<T>;
}

test.describe('live robustness smoke', () => {
  test.skip(!process.env.LIVE, 'discovery-only — set LIVE=1 to run (never gates CI)');

  test('reports autofill coverage per target', async ({ context, extensionId }) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dev-only runner; path is a developer-controlled config, never user input
    const cfg = JSON.parse(readFileSync(TARGETS_PATH, 'utf8')) as Config;
    const threshold = cfg.coverageThreshold ?? 0.6;
    const targets = (cfg.targets ?? []).filter((t) => !t.url.includes('<')); // skip un-filled templates
    test.skip(targets.length === 0, `no runnable targets in ${TARGETS_PATH} (fill in the <company>/<job-id> URLs)`);

    // Demo mode ON → dummy identity, so no real data is ever entered.
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
    await opt.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
    await opt.close();

    // Mechanical guard: fill-only, never submit an application to a real employer.
    await installNoSubmit(context);

    const rows: Row[] = [];
    for (const t of targets) {
      const page = await context.newPage();
      try {
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(2500); // let the SPA render + content script attach
        // Ground truth INDEPENDENT of the extension: does the page itself actually have a form?
        // This separates "expired/blocked page, no form" from "form present but the extension saw nothing".
        const pageInputs = await page
          .$$eval(
            'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=search]), select, textarea',
            (els) => els.length,
          )
          .catch(() => 0);
        const state = await rpc<{ fields: number; relevant: boolean }>(context, 'getState');
        const fill = await rpc<{ filled: number; review: number; total: number }>(context, 'autofill', {
          mode: 'default',
        });
        const attached = state.answered;
        const detected = state.answered ? (state.value?.fields ?? 0) : 0;
        const filled = fill.answered ? (fill.value?.filled ?? 0) : 0;
        // Denominator = the most complete field count we have (getState vs the autofill pass can differ,
        // and multi-row fills can push `filled` above a single count) — clamp so coverage never exceeds 100%.
        const denom = Math.max(detected, (fill.answered ? fill.value?.total : 0) ?? 0, filled);
        const coverage = denom > 0 ? Math.min(1, Math.round((filled / denom) * 100) / 100) : null;
        const note =
          pageInputs < 3
            ? 'no form on page (expired / blocked?)'
            : !attached
              ? '✖ NO CONTENT SCRIPT — never attached, nothing measured (not a detection bug)'
              : detected === 0
                ? '⚠ DETECTION GAP — form present, content script attached and saw nothing'
                : coverage != null && coverage < threshold
                  ? '⚠ FIXTURE CANDIDATE'
                  : 'ok';
        rows.push({ ats: t.ats, url: t.url, pageInputs, detected, filled, coverage, note });
      } catch (e) {
        rows.push({
          ats: t.ats,
          url: t.url,
          pageInputs: 0,
          detected: 0,
          filled: 0,
          coverage: null,
          note: `unreachable: ${(e as Error).message.split('\n')[0]}`,
        });
      } finally {
        await page.close();
      }
    }

    // Report — the deliverable. Never fails on a live result.
    console.table(
      rows.map((r) => ({
        ats: r.ats,
        pageInputs: r.pageInputs,
        detected: r.detected,
        filled: r.filled,
        coverage: r.coverage,
        note: r.note,
      })),
    );
    // A candidate = the page really has a form but the extension underperforms (gap or low coverage) —
    // NOT expired/blocked pages, so we don't chase dead URLs.
    const candidates = rows
      .filter((r) => r.note.includes('DETECTION GAP') || r.note.includes('FIXTURE CANDIDATE'))
      .map((r) => ({ ats: r.ats, url: r.url, detected: r.detected, filled: r.filled, coverage: r.coverage }));
    const outDir = path.resolve(process.cwd(), 'test-results');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'live-coverage.json'), JSON.stringify({ threshold, rows, candidates }, null, 2));
    console.log(
      `\n${candidates.length} fixture candidate(s) below ${threshold * 100}% coverage → test-results/live-coverage.json`,
    );
  });
});
