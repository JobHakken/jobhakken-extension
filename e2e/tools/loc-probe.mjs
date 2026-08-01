import { chromium } from '@playwright/test';
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
  viewport: { width: 1280, height: 1200 },
});
const p = await ctx.newPage();
await p.goto('https://jobs.ashbyhq.com/replit/47235851-fadd-4bd7-9cc6-61f545059ac1/application', {
  waitUntil: 'domcontentloaded',
  timeout: 45000,
});
await p.waitForTimeout(4500);
const info = await p.evaluate(() => {
  const lab = [...document.querySelectorAll('label,[class*=label]')].find((l) =>
    /^location\b/i.test((l.textContent || '').trim()),
  );
  if (!lab) return { found: false };
  const cont = lab.closest('div');
  const input = cont?.querySelector('input');
  return {
    found: true,
    labelText: (lab.textContent || '').trim().slice(0, 30),
    inputTag: input?.tagName,
    role: input?.getAttribute('role'),
    ariaAuto: input?.getAttribute('aria-autocomplete'),
    ariaHaspopup: input?.getAttribute('aria-haspopup'),
    inputClass: (input?.className || '').slice(0, 60),
    hasSelectControl: !!cont?.querySelector('[class*="select__control"],[class*="react-select"],[class*="Select-"]'),
    contHtml: (cont?.outerHTML || '').replace(/\s+/g, ' ').slice(0, 400),
  };
});
console.log(JSON.stringify(info, null, 1));
// try typing into it manually to see if suggestions appear
if (info.found) {
  const input = p.locator('label:has-text("Location")').locator('..').locator('input').first();
  await input.click().catch(() => {});
  await input.fill('Austin').catch(() => {});
  await p.waitForTimeout(2500);
  const opts = await p.evaluate(() =>
    [...document.querySelectorAll('[role=option],[class*=option]')]
      .map((o) => o.textContent.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 6),
  );
  console.log('suggestions after typing "Austin":', JSON.stringify(opts));
}
await ctx.close();
