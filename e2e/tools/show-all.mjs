/**
 * Open ONE real Chrome window with the extension, a tab per ATS, autofill each, and leave the
 * whole window open so you can flip through the tabs and review. Fill-only, never submits.
 *   node e2e/tools/show-all.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '../../dist');

const SITES = [
  ['Greenhouse (Two Six)', 'https://job-boards.greenhouse.io/twosixtechnologies/jobs/6123756004'],
  ['Lever', 'https://jobs.lever.co/lumotive/836459a4-705a-46c8-bbec-fc957125787b/apply'],
  ['JazzHR', 'https://paradromicsinc.applytojob.com/apply/u5hXN4N9ID/Embedded-Software-Engineer'],
  ['Ashby', 'https://jobs.ashbyhq.com/openai/3f99bfef-5b1a-48ea-aed0-2dbd57b12722/application'],
  ['Workable', 'https://apply.workable.com/futuresearch/j/00E7FC1B6F/apply/'],
  ['BambooHR', 'https://g2.bamboohr.com/careers/148'],
  ['Recruitee', 'https://crossing.recruitee.com/o/embedded-software-engineering?lang=en'],
  ['Jobvite', 'https://jobs.jobvite.com/kymetacorp/job/o2DRzfwP/apply'],
];

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--start-maximized'],
});
ctx.on('close', () => process.exit(0));
// safety: fill-only, never submit
await ctx.addInitScript(() =>
  window.addEventListener(
    'submit',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  ),
);

let sw = ctx.serviceWorkers()[0];
for (let i = 0; i < 20 && !sw; i++) {
  await new Promise((r) => setTimeout(r, 500));
  sw = ctx.serviceWorkers()[0];
}
const extId = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true, f2a_fill_sensitive: true }));
await cfg.close();

async function autofillActive() {
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    let frameId;
    try {
      const key = `f2a_frames:${tab.id}`;
      const counts = (await chrome.storage.session.get(key))[key] ?? {};
      let best = 0;
      for (const [f, c] of Object.entries(counts))
        if (c > best) {
          best = c;
          frameId = Number(f);
        }
    } catch {}
    try {
      await chrome.tabs.sendMessage(
        tab.id,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'default' } },
        frameId != null ? { frameId } : {},
      );
    } catch {}
  });
}

const FIELD =
  'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox], [class*=yesno]';
for (const [name, url] of SITES) {
  const page = await ctx.newPage();
  try {
    console.log(`→ ${name}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector(FIELD, { timeout: 20000 }).catch(() => {});
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
        await page.waitForSelector(FIELD, { timeout: 15000 }).catch(() => {});
      }
    }
    await page.bringToFront();
    for (let i = 0; i < 4; i++) {
      await autofillActive();
      await page.waitForTimeout(1500);
    }
    console.log(`  ✓ ${name} filled`);
  } catch (e) {
    console.log(`  ! ${name}: ${String(e).slice(0, 80)}`);
  }
}
console.log(
  '\n>>> ALL SITES FILLED — window left open. Flip through the tabs to review. Close the window when done. <<<\n',
);
await new Promise(() => {});
