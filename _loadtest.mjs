import { chromium } from '@playwright/test';
const EXT = '/Users/mighty/Documents/github/job/jobhakken-extension/dist';
try {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chrome',
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 8000 });
  console.log('LOADED OK in real Chrome, ext id:', sw.url().split('/')[2]);
  await ctx.close();
} catch (e) {
  console.log('LOAD FAILED:', String(e).split('\n')[0].slice(0, 200));
}
