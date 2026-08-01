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
const res = await p.evaluate(async () => {
  const inp =
    document.querySelector('input#_systemfield_location, input[id*=location]') ||
    [...document.querySelectorAll('input[role=combobox]')].find((i) =>
      /location/i.test(i.closest('div')?.textContent || ''),
    );
  if (!inp) return { found: false };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  inp.focus();
  setter.call(inp, 'Austin, TX');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'X' }));
  await new Promise((r) => setTimeout(r, 4000));
  const controls = inp.getAttribute('aria-controls');
  const active = inp.getAttribute('aria-activedescendant');
  const lb = (controls && document.getElementById(controls)) || document.querySelector('[role=listbox]');
  const opts = lb ? [...lb.querySelectorAll('[role=option]')].map((o) => o.textContent.trim().slice(0, 50)) : [];
  // also scan whole doc for anything that looks like a geo suggestion
  const anyGeo = [...document.querySelectorAll('[role=option],li,[class*=option],[class*=suggest]')]
    .map((o) => (o.textContent || '').trim())
    .filter((t) => /austin|texas|,\s*(TX|USA)/i.test(t))
    .slice(0, 5);
  return {
    found: true,
    ariaControls: controls,
    ariaActive: active,
    listboxFound: !!lb,
    optCount: opts.length,
    opts: opts.slice(0, 5),
    anyGeo,
  };
});
console.log(JSON.stringify(res, null, 1));
await ctx.close();
