/**
 * Golden coverage tests (plan §5) — the honest, DETERMINISTIC gate.
 *
 * The old signal ("N fields filled") measures fills, not CORRECT fills — a rule that puts your
 * phone in the wrong box scores 100%. These tests compare each filled field to a human-authored
 * expected VALUE (per e2e/goldens/*.golden.json), and report precision + recall separately
 * (filling wrong is worse than not filling).
 *
 * Runs against the committed local fixtures in Demo mode (dummy data) — so it's fast, offline, and
 * part of the normal `npm run test:e2e` gate. `gate:true` fields fail the build on regression;
 * `gate:false` fields are reported as coverage/gaps (work to hand upstream to @jobhakken/autofill).
 */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { BrowserContext, chromium, expect, test as base } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '../dist');
const GOLDEN_DIR = path.resolve(__dirname, 'goldens');

// A field is located by a CSS `selector` OR (more robustly, for sites with volatile ids like
// SuccessFactors) by `label` — a case-insensitive regex matched against the field's label/ARIA name.
type Field = {
  selector?: string;
  label?: string;
  expect: string;
  match?: 'exact' | 'contains';
  gate?: boolean;
  note?: string;
};
// `minRecall` is the coverage FLOOR: the build fails if overall recall drops below it. This makes a
// coverage *regression* (e.g. a lib change that stops filling a non-gated field) redden the gate,
// not just print a note — the gap the rationalization/Workday-phone regression slipped through.
type Golden = { fixture: string; profile?: string; minRecall?: number; fields: Field[] };

function fieldKey(f: Field): string {
  return f.selector ?? `label:${f.label}`;
}
function fieldLocator(page: import('@playwright/test').Page, f: Field) {
  // eslint-disable-next-line security/detect-non-literal-regexp -- label comes from a committed golden fixture, not user input
  return f.label ? page.getByLabel(new RegExp(f.label, 'i')).first() : page.locator(f.selector as string);
}

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

/** Trigger autofill on the active tab, targeting the form frame (all_frames → pick the busiest). */
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
      /* fall back to broadcast */
    }
    try {
      await chrome.tabs.sendMessage(
        tab.id,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'default' } },
        frameId != null ? { frameId } : {},
      );
    } catch {
      /* content script not ready — the poll retries */
    }
  });
}

const goldens: Golden[] = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.golden.json'))
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- committed test fixtures under a fixed dir
  .map((f) => JSON.parse(readFileSync(path.join(GOLDEN_DIR, f), 'utf8')) as Golden);

for (const g of goldens) {
  test(`golden coverage: ${g.fixture}`, async ({ context, extensionId }) => {
    // Enable Demo mode from an extension page → dummy identity, so no real data is ever entered.
    const cfg = await context.newPage();
    await cfg.goto(`chrome-extension://${extensionId}/options/options.html`);
    await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
    await cfg.close();

    const page = await context.newPage();
    await page.goto(`/${g.fixture}`);

    // Poll autofill until a gated field takes a value (the sync pass is fast; AI passes are slower).
    const anchor = g.fields.find((f) => f.gate) ?? g.fields[0];
    await expect
      .poll(
        async () => {
          await autofill(context);
          return fieldLocator(page, anchor)
            .inputValue()
            .catch(() => '');
        },
        { timeout: 25_000 },
      )
      .not.toBe('');

    // Score every golden field.
    let correct = 0;
    let filled = 0;
    const gaps: Array<{ field: string; expected: string; got: string; note?: string }> = [];
    for (const f of g.fields) {
      const val = (
        await fieldLocator(page, f)
          .inputValue()
          .catch(() => '')
      ).trim();
      const isFilled = val !== '';
      const ok = f.match === 'contains' ? val.includes(f.expect) : val === f.expect;
      if (isFilled) filled++;
      if (ok) correct++;
      else if (!f.gate) gaps.push({ field: fieldKey(f), expected: f.expect, got: val || '(empty)', note: f.note });

      // Hard gate: core fields must be exactly right, or the build fails (regression guard).
      if (f.gate) {
        if (f.match === 'contains') expect(val, `gated ${fieldKey(f)}`).toContain(f.expect);
        else expect(val, `gated ${fieldKey(f)}`).toBe(f.expect);
      }
    }

    const recall = Math.round((correct / g.fields.length) * 100) / 100;
    const precision = filled ? Math.round((correct / filled) * 100) / 100 : 0;
    console.log(
      `\n[golden] ${g.fixture} — precision ${precision} · recall ${recall} · correct ${correct}/${g.fields.length}`,
    );
    if (gaps.length) console.log(`[golden] ${gaps.length} non-gated gap(s) → upstream @jobhakken/autofill:`, gaps);

    // Coverage floor: fail the gate if overall recall regresses below the committed baseline.
    if (g.minRecall != null) {
      expect(
        recall,
        `${g.fixture} recall floor (a coverage regression) — gaps: ${JSON.stringify(gaps)}`,
      ).toBeGreaterThanOrEqual(g.minRecall);
    }
  });
}
