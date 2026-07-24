import path from 'path';
import { fileURLToPath } from 'url';

import { BrowserContext, chromium, expect, test as base } from '@playwright/test';

// ESM scope (package is "type":"module") — no CJS __dirname; derive it from import.meta.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// `chrome` is a browser-context global available inside page.evaluate on an extension page
declare const chrome: {
  storage: {
    local: { set(items: Record<string, unknown>): Promise<void>; get(keys: string): Promise<Record<string, unknown>> };
  };
  tabs: { query(q: object): Promise<Array<{ id?: number }>>; sendMessage(id: number, msg: unknown): Promise<unknown> };
};

/** Point the extension at the mock bridge, choosing the test-mode scenario via the token. */
const mockConnection = (testMode: boolean) => ({
  f2a_connection: {
    port: 41599, // mock bridge's dedicated test port (see e2e/mock-bridge.mjs)
    token: testMode ? 'TESTMODE' : 'REAL',
    profile: { hasResume: true, basics: { name: 'Real Person', email: 'real.person@corp.example' } },
  },
});

/** Load the built MV3 extension into a persistent Chromium context (extensions need this). */
const EXT_DIR = path.resolve(__dirname, '../dist');

// PWHEAD=1 → a REAL visible window (drop --headless=new) + slowMo, so you can watch the
// extension act. Otherwise use --headless=new (extensions load only in headed/new-headless).
const HEADED = process.env.PWHEAD === '1';

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false, // Chromium loads extensions only in headed / new-headless mode
      slowMo: HEADED ? 400 : process.env.DEMO_VIDEO ? 150 : 0,
      // DEMO_VIDEO=<dir> records each page's video to <dir> (for store-listing / demo clips).
      // This context is built manually (extensions require launchPersistentContext), so it's
      // NOT covered by playwright.config.ts's `use.video` — recordVideo must be set here.
      recordVideo: process.env.DEMO_VIDEO
        ? { dir: process.env.DEMO_VIDEO, size: { width: 1280, height: 800 } }
        : undefined,
      args: [
        ...(HEADED ? [] : ['--headless=new']),
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
      ],
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
 * Drive autofill exactly as the toolbar popup does — via the content-script RPC on the active
 * tab (the popup can't be opened as a real toolbar popup in Playwright, and opening popup.html
 * as a tab would steal "active tab"; messaging from the service worker is the faithful proxy).
 */
async function autofillActiveTab(context: BrowserContext, mode: 'default' | 'ats' = 'default') {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(async (m) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'f2a-rpc', method: 'autofill', params: { mode: m } });
    } catch {
      /* content script not ready yet — the caller's expect.poll will retry */
    }
  }, mode);
}

test('autofills the Greenhouse fixture from the built-in test profile', async ({ context, extensionId }, testInfo) => {
  // enable Demo mode (the extension then fills the anonymous TEST_PROFILE)
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opt.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
  await opt.close();

  const page = await context.newPage();
  await page.goto('/greenhouse.samsung.html');
  // visual evidence: the empty form BEFORE autofill
  await testInfo.attach('autofill-1-before.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  // retry autofill until the content script is ready + the field takes the test-profile value.
  // autofillActiveTab awaits the FULL autofill (sync fields + the interactive combobox/upload
  // pass, which the popup itself bounds to ~20s); this real Greenhouse capture (reCAPTCHA + many
  // comboboxes) legitimately takes ~13s, so allow the poll enough headroom for one full pass.
  await expect
    .poll(
      async () => {
        await autofillActiveTab(context);
        return page
          .getByLabel(/First Name/i)
          .inputValue()
          .catch(() => '');
      },
      { timeout: 25_000 },
    )
    .toBe('Jordan');
  await expect(page.getByLabel(/Email/i).first()).toHaveValue('jordan.rivera@example.com');
  // visual evidence: the same form AFTER autofill (open the trace/report to see filling quality)
  await testInfo.attach('autofill-2-after.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('popup renders the control center (status + Autofill), no floating panel is injected', async ({
  context,
  extensionId,
}) => {
  // a job page never gets a floating on-page panel anymore (the popup is the UI)
  const page = await context.newPage();
  await page.goto('/greenhouse.samsung.html');
  await page.waitForTimeout(1200);
  expect(await page.locator('#f2a-panel-host').count()).toBe(0);

  // the toolbar popup itself renders its control center
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator('#autofill')).toBeVisible();
  await expect(popup.locator('.nm')).toHaveText(/JobHakken/);
  await expect(popup.locator('#ver')).toHaveText(/^v\d/);
  // feedback affordance: "⚑ Report this page" with reason options, and it points at GitHub
  await popup.locator('#report summary').click();
  await expect(popup.locator('.rbody button')).toHaveCount(4);
  await expect(popup.locator('.rbody button[data-r="not-detected"]')).toBeVisible();
});

test('captures the filled flow — autofill vs manual, with PII reduced to shapes', async ({ context, extensionId }) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  // auto-capture is opt-in (default OFF) → enable it explicitly for this capture test
  await opt.evaluate(() =>
    chrome.storage.local.set({ f2a_test_mode: true, f2a_auto_capture: true, f2a_capture_sites: ['127.0.0.1'] }),
  );
  await opt.close();

  const page = await context.newPage();
  await page.goto('/e2e/sandbox.html');
  await expect
    .poll(
      async () => {
        await autofillActiveTab(context);
        return page
          .getByLabel(/First Name/i)
          .inputValue()
          .catch(() => '');
      },
      { timeout: 8000 },
    )
    .toBe('Jordan');

  // person manually overrides First Name (was autofilled) → should read as "manual"
  await page.getByLabel(/First Name/i).fill('Alex');
  await page.waitForTimeout(2200); // let the debounced flow-capture run

  const store = await context.newPage();
  await store.goto(`chrome-extension://${extensionId}/options/options.html`);
  const fields = await store.evaluate(async () => {
    const idx = (await chrome.storage.local.get('f2a_cap_index'))['f2a_cap_index'] as Array<{ key: string }>;
    if (!idx?.length) return null;
    const rec = (await chrome.storage.local.get(idx[0].key))[idx[0].key] as {
      fields?: Array<{ label: string; filledBy: string; value?: string }>;
    };
    return rec?.fields ?? null;
  });
  expect(fields).toBeTruthy();
  const first = fields!.find((f) => /first name/i.test(f.label));
  const email = fields!.find((f) => /email/i.test(f.label));
  expect(first?.filledBy).toBe('manual'); // user overrode it
  expect(email?.filledBy).toBe('autofill'); // we filled it
  expect(email?.value).toBe('[email]'); // PII reduced to a shape
});

test('app-in-test-mode syncs to the extension — fills DUMMY, never the real name', async ({ context, extensionId }) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  // extension's own toggle OFF, a REAL local profile saved, and connected to an app that
  // reports test mode — the extension must still fill anonymous data (the reported bug).
  await opt.evaluate(
    (conn) =>
      chrome.storage.local.set({
        f2a_test_mode: false,
        f2a_full_profile: { profile: { firstName: 'RealLocal', lastName: 'Person', email: 'real.local@corp.example' } },
        ...conn,
      }),
    mockConnection(true),
  );
  await opt.close();

  const page = await context.newPage();
  await page.goto('/e2e/sandbox.html');
  // app said "test mode" → dummy identity wins over both the real connection AND local profile
  await expect
    .poll(
      async () => {
        await autofillActiveTab(context);
        return page
          .getByLabel(/First Name/i)
          .inputValue()
          .catch(() => '');
      },
      { timeout: 8000 },
    )
    .toBe('Jordan');
  await expect(page.getByLabel(/Email/i).first()).toHaveValue('jordan.rivera@example.com');
});

test('Options: "Import" in test mode loads the dummy profile, not real data', async ({ context, extensionId }) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opt.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
  await opt.reload(); // pick up test mode → Import becomes usable + imports dummy
  await opt.locator('#importBtn').click();
  await expect
    .poll(async () =>
      opt.evaluate(
        async () =>
          (
            (await chrome.storage.local.get('f2a_full_profile'))['f2a_full_profile'] as {
              profile?: { firstName?: string };
            }
          )?.profile?.firstName ?? '',
      ),
    )
    .toBe('Jordan');
});

test('sponsorship filter: marks a blocked LinkedIn job TILE when the toggle is on', async ({
  context,
  extensionId,
}, testInfo) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opt.evaluate(() => chrome.storage.local.set({ f2a_needs_sponsorship: true }));
  await opt.close();

  const page = await context.newPage();
  await page.goto('/e2e/linkedin-job.html?currentJobId=12345');

  // the open job's TILE (matched by its /jobs/view/12345 link) gets a red "No sponsorship" mark
  const card = page.locator('.job-card-container', { has: page.locator('a[href*="/jobs/view/12345"]') });
  await expect(card.locator('.f2a-elig-mark')).toBeVisible({ timeout: 5000 });
  await expect(card.locator('.f2a-elig-mark')).toContainText(/no sponsorship/i);
  await testInfo.attach('sponsorship-tile-mark.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('sponsorship filter: marks next to the TITLE on a job-detail page (no list tiles)', async ({
  context,
  extensionId,
}, testInfo) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opt.evaluate(() => chrome.storage.local.set({ f2a_needs_sponsorship: true }));
  await opt.close();

  const page = await context.newPage();
  await page.goto('/e2e/linkedin-detail.html'); // no currentJobId in the URL → id comes from the JD container
  const mark = page.locator('.f2a-elig-mark');
  await expect(mark).toBeVisible({ timeout: 5000 });
  await expect(mark).toHaveAttribute('title', /won't sponsor/i);
  // it sits right after the job title link (not in the description)
  await expect(page.locator('a[href="/jobs/view/4422607999"] + .f2a-elig-mark')).toHaveCount(1);
  await testInfo.attach('sponsorship-title-mark.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('H-1B badge: flags a known sponsor company inline (bundled data, no app)', async ({
  context,
  extensionId,
}, testInfo) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opt.evaluate(() => chrome.storage.local.set({ f2a_needs_sponsorship: true }));
  await opt.close();

  const page = await context.newPage();
  await page.goto('/e2e/linkedin-h1b.html');
  // the service worker loads the bundled list on first query, then a green badge appears
  const badge = page.locator('.f2a-h1b-badge');
  await expect(badge).toBeVisible({ timeout: 8000 });
  await expect(badge).toContainText(/H-1B sponsor/i);
  // it sits next to the company link, not the JD
  await expect(page.locator('a[href="/company/google/"] + .f2a-h1b-badge')).toHaveCount(1);
  await testInfo.attach('h1b-badge.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('Workday: autofills the real My Information page (text fields fill)', async ({
  context,
  extensionId,
}, testInfo) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opt.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
  await opt.close();

  const page = await context.newPage();
  await page.goto('/workday/02-my-information.html');
  await testInfo.attach('workday-before.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  await expect
    .poll(
      async () => {
        await autofillActiveTab(context);
        return page
          .locator('#name--legalName--firstName')
          .inputValue()
          .catch(() => '');
      },
      { timeout: 8000 },
    )
    .toBe('Jordan');
  // more text fields stuck (address / city), and the fill tagged several fields
  await expect(page.locator('#name--legalName--lastName')).toHaveValue('Rivera');
  await expect(page.locator('#address--city')).not.toHaveValue('');
  expect(await page.locator('[data-f2a-filled="1"]').count()).toBeGreaterThanOrEqual(4);
  await testInfo.attach('workday-after.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('both signals coexist without duplicating, and re-inject after a wipe (React-churn guard)', async ({
  context,
  extensionId,
}) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opt.evaluate(() => chrome.storage.local.set({ f2a_needs_sponsorship: true }));
  await opt.close();

  const page = await context.newPage();
  await page.goto('/e2e/linkedin-both.html');
  const green = page.locator('.f2a-h1b-badge');
  const red = page.locator('.f2a-elig-mark');
  await expect(green).toHaveCount(1, { timeout: 5000 });
  await expect(red).toHaveCount(1);

  // force several DOM mutations (re-scans) — must NOT duplicate the badges
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const d = document.createElement('div');
      document.body.appendChild(d);
      d.remove();
    });
    await page.waitForTimeout(900); // let the debounced re-scan run
  }
  await expect(green).toHaveCount(1);
  await expect(red).toHaveCount(1);

  // simulate React wiping our green badge → it should re-inject on the next scan
  await page.evaluate(() => document.querySelector('.f2a-h1b-badge')?.remove());
  await expect(green).toHaveCount(0);
  await page.evaluate(() => {
    const d = document.createElement('div');
    document.body.appendChild(d);
    d.remove();
  });
  await expect(green).toHaveCount(1, { timeout: 3000 }); // re-injected
});

test('sponsorship filter: hides the tile when "hide" is on', async ({ context, extensionId }) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opt.evaluate(() => chrome.storage.local.set({ f2a_needs_sponsorship: true, f2a_hide_unsponsored: true }));
  await opt.close();

  const page = await context.newPage();
  await page.goto('/e2e/linkedin-job.html?currentJobId=12345');
  const card = page.locator('.job-card-container', { has: page.locator('a[href*="/jobs/view/12345"]') });
  await expect(card).toHaveAttribute('data-f2a-elig', 'hidden', { timeout: 5000 });
  await expect(card).toBeHidden();
});

test('sponsorship filter: no mark when OFF, and none on a clean role', async ({ context, extensionId }) => {
  // toggle OFF (default) → even a blocked JD gets no mark
  const off = await context.newPage();
  await off.goto('/e2e/linkedin-job.html?currentJobId=12345');
  await off.waitForTimeout(1500);
  expect(await off.locator('.f2a-elig-mark').count()).toBe(0);
  await off.close();

  // toggle ON but a clean JD (offers sponsorship) → still no mark
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opt.evaluate(() => chrome.storage.local.set({ f2a_needs_sponsorship: true }));
  await opt.close();

  const clean = await context.newPage();
  await clean.goto('/e2e/linkedin-clean.html?currentJobId=67890');
  await clean.waitForTimeout(1500);
  expect(await clean.locator('.f2a-elig-mark').count()).toBe(0);
});

test('reports Standalone (not Connected) when the app/bridge is unreachable', async ({ context, extensionId }) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  // cached connection creds pointing at a DEAD port → bridge not live (app closed)
  await opt.evaluate(() =>
    chrome.storage.local.set({
      f2a_connection: { port: 49999, token: 'x', profile: { hasResume: true, basics: { name: 'X' } } },
    }),
  );
  await opt.close();

  const page = await context.newPage();
  await page.goto('/e2e/sandbox.html');
  // the popup reads mode() from the content script via getState — a dead bridge → "standalone"
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await expect
    .poll(
      async () =>
        sw.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) return '';
          try {
            const s = (await chrome.tabs.sendMessage(tab.id, { type: 'f2a-rpc', method: 'getState' })) as {
              mode?: string;
            };
            return s?.mode ?? '';
          } catch {
            return '';
          }
        }),
      { timeout: 8000 },
    )
    .toBe('standalone');
});

test('uploads a résumé and picks a lazy dropdown in a real browser', async ({ context, extensionId }) => {
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extensionId}/options/options.html`);
  // test mode + auto-capture ON (opt-in, default OFF) + opt this (non-ATS) host in, to exercise the
  // capture path. fill_sensitive ON because this test asserts the Gender (EEO/sensitive) combobox —
  // sensitive fields default OFF (bd3a43b), so without this the Gender field is correctly skipped.
  await opt.evaluate(() =>
    chrome.storage.local.set({
      f2a_test_mode: true,
      f2a_auto_capture: true,
      f2a_capture_sites: ['127.0.0.1'],
      f2a_fill_sensitive: true,
    }),
  );
  await opt.close();

  const page = await context.newPage();
  await page.goto('/e2e/sandbox.html');

  await expect
    .poll(
      async () => {
        await autofillActiveTab(context);
        return page
          .getByLabel(/First Name/i)
          .inputValue()
          .catch(() => '');
      },
      { timeout: 8000 },
    )
    .toBe('Jordan');
  // résumé attached to the file input (DataTransfer — only works in a real browser)
  await expect
    .poll(async () => page.locator('#rz').evaluate((el: HTMLInputElement) => el.files?.[0]?.name ?? ''))
    .toMatch(/resume\.pdf$/i);
  // cover letter attached too (test mode → dummy PDF)
  await expect
    .poll(async () => page.locator('#cl').evaluate((el: HTMLInputElement) => el.files?.[0]?.name ?? ''))
    .toMatch(/cover-letter\.pdf$/i);
  // the lazy Gender combobox was opened and the matching option selected
  await expect
    .poll(async () => page.locator('#g').evaluate((el) => el.getAttribute('data-value') ?? ''))
    .toBe('Prefer not to say');

  // auto-capture stored the (anonymized) application locally
  const store = await context.newPage();
  await store.goto(`chrome-extension://${extensionId}/options/options.html`);
  await expect
    .poll(async () =>
      store.evaluate(
        async () => ((await chrome.storage.local.get('f2a_cap_index'))['f2a_cap_index'] as unknown[])?.length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
});
