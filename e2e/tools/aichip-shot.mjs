import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 360, height: 340 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const p = await ctx.newPage();
await p.goto(`chrome-extension://${extId}/popup/popup.html`);
await p.waitForTimeout(700);
await p.evaluate(() => {
  document.getElementById('setupCta')?.classList.add('hidden');
  document.getElementById('fillResult').innerHTML =
    '<span class="chip ok">✓ 13 filled</span><button class="chip jump">1 to review →</button><span class="chip ai" title="AI answers">✍️ 2 AI answers</span>';
});
await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/shots/aichip.png' });
console.log('saved');
await ctx.close();
