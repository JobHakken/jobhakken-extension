// Remaining postings not in batch-verify.mjs — BambooHR family + SmartRecruiters/Breezy/Teamtailor extras.
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '../../dist');
const URLS = [
  ['BambooHR/G2', 'https://g2.bamboohr.com/careers/148'],
  ['BambooHR/Signal1-39', 'https://signal1.bamboohr.com/careers/39'],
  ['BambooHR/Signal1-40', 'https://signal1.bamboohr.com/careers/40'],
  ['SmartRec/Wabtec', 'https://jobs.smartrecruiters.com/Wabtec/3743990013131656-embedded-software-engineer-iii'],
  ['SmartRec/Aczet', 'https://jobs.smartrecruiters.com/AczetPvtLtd/743999665450626-firmware-engineer'],
  ['Breezy/Rapta', 'https://rapta-inc.breezy.hr/p/d7f1a591e004-senior-software-engineer/apply'],
  ['Breezy/Archangel', 'https://archangellightworks.breezy.hr/p/52fd6f6b18e501-embedded-software-engineer/apply'],
  [
    'Teamtailor/Combine',
    'https://combine.teamtailor.com/jobs/7798743-system-software-engineer-model-based-development',
  ],
  [
    'Teamtailor/SaaS',
    'https://saasglobal.teamtailor.com/jobs/7868728-senior-backend-software-engineer-php-python-contractor',
  ],
];
const FIELD =
  'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox], [class*=yesno]';
for (const [name, url] of URLS) {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
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
  try {
    const id = sw.url().split('/')[2];
    const cfg = await ctx.newPage();
    await cfg.goto(`chrome-extension://${id}/options/options.html`);
    await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true, f2a_fill_sensitive: true }));
    await cfg.close();
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector(FIELD, { timeout: 18000 }).catch(() => {});
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
        await page.waitForSelector(FIELD, { timeout: 12000 }).catch(() => {});
      }
    }
    for (let i = 0; i < 4; i++) {
      await sw.evaluate(async () => {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!t?.id) return;
        let fid;
        try {
          const k = `f2a_frames:${t.id}`;
          const c = (await chrome.storage.session.get(k))[k] ?? {};
          let b = 0;
          for (const [f, n] of Object.entries(c))
            if (n > b) {
              b = n;
              fid = Number(f);
            }
        } catch {}
        try {
          await chrome.tabs.sendMessage(
            t.id,
            { type: 'f2a-rpc', method: 'autofill', params: { mode: 'default' } },
            fid != null ? { frameId: fid } : {},
          );
        } catch {}
      });
      await page.waitForTimeout(1500);
    }
    const r = await page.evaluate(() => {
      const texts = [
        ...document.querySelectorAll(
          'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]), textarea',
        ),
      ].filter((e) => !e.closest('.select__control'));
      const rs = [...document.querySelectorAll('.select__control, [class*="select__control"]')];
      const files = [...document.querySelectorAll('input[type=file]')]
        .map((e) => e.files?.[0]?.name || '')
        .filter(Boolean);
      return {
        texts: `${texts.filter((e) => (e.value || '').trim()).length}/${texts.length}`,
        rsel: `${rs.filter((c) => c.querySelector('.select__single-value, [class*=single-value]')?.textContent?.trim()).length}/${rs.length}`,
        files: files.length,
        checked:
          document.querySelectorAll('input:checked').length +
          [...document.querySelectorAll('[class*=yesno] button')].filter((b) => /_active|selected/i.test(b.className))
            .length,
      };
    });
    console.log(
      `${name.padEnd(22)} text ${r.texts.padEnd(7)} rsel ${r.rsel.padEnd(6)} files ${r.files} checked ${r.checked}`,
    );
  } catch (e) {
    console.log(`${name.padEnd(22)} ERR ${String(e).slice(0, 70)}`);
  }
  await ctx.close();
}
console.log('BATCH2 DONE');
