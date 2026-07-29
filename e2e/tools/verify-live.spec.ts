/**
 * Interactive coverage verifier (the honest measure) — loads a LIVE form with the real extension in
 * Demo mode, runs autofill (incl. the slow interactive pass for dropdowns/uploads), then reads EVERY
 * fillable control the way a browser sees it: text value, react-select displayed value, native select,
 * file name, checked radios/checkboxes. Reports full-form coverage — the thing static fixtures can't.
 *
 * Discovery-only (never a gate): live pages rot/flake. Fill/browse-only, never submits.
 *   VERIFY=1 VERIFY_URL="https://job-boards.greenhouse.io/acme/jobs/123" npm run verify:live
 * Some ATS gate the form behind an Apply/"I'm interested" button — this clicks it first.
 */
import path from 'path';
import { fileURLToPath } from 'url';

import { BrowserContext, chromium, test as base } from '@playwright/test';

import { installNoSubmit } from '../support/noSubmit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '../../dist');

declare const chrome: {
  storage: {
    local: { set(i: Record<string, unknown>): Promise<void> };
    session: { get(k: string): Promise<Record<string, unknown>> };
  };
  tabs: {
    query(q: object): Promise<Array<{ id?: number }>>;
    sendMessage(id: number, m: unknown, o?: object): Promise<unknown>;
  };
};

// PWHEAD=1 → a REAL visible window (watch the extension fill in slow-mo); else new-headless.
const HEADED = process.env.PWHEAD === '1';

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const c = await chromium.launchPersistentContext('', {
      headless: false,
      slowMo: HEADED ? 300 : 0,
      args: [
        ...(HEADED ? [] : ['--headless=new']),
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
      ],
    });
    await use(c);
    await c.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]);
  },
});

async function autofill(context: BrowserContext, mode: 'default' | 'ats'): Promise<void> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(async (m) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    let frameId: number | undefined;
    try {
      const key = `f2a_frames:${tab.id}`;
      // eslint-disable-next-line security/detect-object-injection -- code-built storage key
      const counts = ((await chrome.storage.session.get(key))[key] ?? {}) as Record<string, number>;
      let best = 0;
      for (const [fid, c] of Object.entries(counts)) {
        if (c > best) {
          best = c;
          frameId = Number(fid);
        }
      }
    } catch {
      /* broadcast */
    }
    try {
      await chrome.tabs.sendMessage(
        tab.id,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: m } },
        frameId != null ? { frameId } : {},
      );
    } catch {
      /* retry */
    }
  }, mode);
}

test('verify live coverage', async ({ context, extensionId }) => {
  test.skip(!process.env.VERIFY, 'discovery tool — set VERIFY=1 VERIFY_URL=<url>');
  const url = process.env.VERIFY_URL;
  test.skip(!url, 'VERIFY_URL required');

  const cfg = await context.newPage();
  await cfg.goto(`chrome-extension://${extensionId}/options/options.html`);
  await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true, f2a_fill_sensitive: true }));
  await cfg.close();
  await installNoSubmit(context);

  const page = await context.newPage();
  await page.goto(url as string, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
  await page.waitForSelector(FIELD, { timeout: 20_000 }).catch(() => {});
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
  // run autofill a few times so the slow interactive pass (comboboxes/uploads) completes
  for (let i = 0; i < 4; i++) {
    await autofill(context, 'default');
    await page.waitForTimeout(2500);
  }

  const rows = await page.evaluate(() => {
    const labelFor = (el: Element): string => {
      const id = (el as HTMLElement).id;
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l?.textContent?.trim()) return l.textContent.trim();
      }
      const aria = el.getAttribute('aria-label');
      if (aria?.trim()) return aria.trim();
      const lb = el.getAttribute('aria-labelledby');
      if (lb) {
        const l = document.getElementById(lb);
        if (l?.textContent?.trim()) return l.textContent.trim();
      }
      const wrap = el.closest('label');
      if (wrap?.textContent?.trim()) return wrap.textContent.trim();
      let n: Element | null = el.closest('div,section,li,fieldset');
      for (let i = 0; n && i < 4; i++, n = n.parentElement) {
        const l = n.querySelector('label,h1,h2,h3,h4,legend');
        if (l?.textContent?.trim()) return l.textContent.trim();
      }
      return (el as HTMLInputElement).name || id || '(?)';
    };
    const out: Array<{ label: string; type: string; value: string; filled: boolean }> = [];
    const seen = new Set<Element>();
    const push = (el: Element, type: string, value: string) => {
      out.push({
        label: labelFor(el).replace(/\s+/g, ' ').slice(0, 48),
        type,
        value: value.slice(0, 34),
        filled: !!value.trim(),
      });
    };
    document
      .querySelectorAll(
        'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=radio]):not([type=checkbox]), textarea',
      )
      .forEach((el) => {
        if ((el as HTMLElement).closest('.select__control')) return; // react-select internal input
        seen.add(el);
        push(
          el,
          el.tagName === 'TEXTAREA' ? 'textarea' : (el as HTMLInputElement).type || 'text',
          (el as HTMLInputElement).value || '',
        );
      });
    document.querySelectorAll('.select__control, [class*="select__control"]').forEach((ctrl) => {
      const sv = ctrl.querySelector('.select__single-value, [class*="single-value"]');
      push(ctrl, 'react-select', sv?.textContent ?? '');
    });
    document.querySelectorAll('select').forEach((el) => {
      const sel = el as HTMLSelectElement;
      const opt = sel.options[sel.selectedIndex];
      push(el, 'native-select', opt && opt.value ? opt.text : '');
    });
    document
      .querySelectorAll('input[type="file"]')
      .forEach((el) => push(el, 'file', (el as HTMLInputElement).files?.[0]?.name ?? ''));
    document
      .querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')
      .forEach((el) => push(el, 'choice', labelFor(el)));
    return out;
  });

  // Visual proof — screenshot the filled form so the run can be eyeballed (not just counted).
  const shot = path.resolve(
    process.cwd(),
    'test-results',
    `verify-${(url as string).replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`,
  );
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

  const fillable = rows.filter((r) => r.type !== 'choice');
  const filled = fillable.filter((r) => r.filled).length;
  console.log(`\n=== ${url}`);
  console.log(`screenshot → ${shot}`);
  console.table(rows.map((r) => ({ label: r.label, type: r.type, filled: r.filled ? '✓' : '—', value: r.value })));
  console.log(
    `\nFULL-FORM COVERAGE: ${filled}/${fillable.length} fillable controls filled (${Math.round((filled / Math.max(1, fillable.length)) * 100)}%)`,
  );
});
