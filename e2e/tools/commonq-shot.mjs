import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 820, height: 560 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const p = await ctx.newPage();
await p.goto(`chrome-extension://${extId}/options/options.html`);
await p.waitForTimeout(500);
await p.locator('.tab[data-t="custom"]').click();
await p.waitForTimeout(300);
await p.locator('#commonQ button', { hasText: 'Notice period' }).click();
await p.waitForTimeout(300);
await p.locator('.panel[data-p="custom"]').screenshot({ path: '/tmp/shots/commonq.png' });
console.log('rule rows after clicking a chip:', (await p.locator('#ruleList input').count()) / 2);
await ctx.close();
