import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 360, height: 470 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const p = await ctx.newPage();
await p.goto(`chrome-extension://${extId}/popup/popup.html`);
await p.waitForTimeout(700);
await p.evaluate(() => {
  document.getElementById('setupCta')?.classList.add('hidden');
  document.getElementById('miniResult').innerHTML = '<span class="chip ok">✓ Drafted 2 answers · ~1.0k tokens</span>';
  const pick = document.getElementById('refinePick');
  pick.innerHTML = '<option>What excites you about Replit?</option><option>Something you built with Replit?</option>';
  document.getElementById('refineToggle').classList.add('hidden');
  document.getElementById('refineBox').classList.remove('hidden');
  document.getElementById('refineInstruction').value = 'make it shorter and mention my Python experience';
});
await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/shots/refine.png' });
console.log('saved');
await ctx.close();
