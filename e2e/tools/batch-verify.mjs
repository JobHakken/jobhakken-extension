/**
 * Batch autonomous verifier — runs the fill+read pipeline over a list of live ATS URLs and prints
 * one compact summary per URL (coverage %, filled files, remaining empties). Fill-only, no submit.
 *   node e2e/tools/batch-verify.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '../../dist');

// Alternate jobs (NOT the ones already tested) across the ATS families we've fixed, plus the
// known-gap families (Breezy/SmartRecruiters/Teamtailor) to re-check.
const URLS = [
  ['Lever/Avive', 'https://jobs.lever.co/AviveSolutions/6d982360-d21c-4389-8a75-9a971d644f1d/apply'],
  ['Lever/Kapta', 'https://jobs.lever.co/kapta-space/036e4881-08a4-4153-999a-ff3d8b621111/apply'],
  ['Ashby/Afference', 'https://jobs.ashbyhq.com/afference/9c78e48c-db07-455a-9193-3fd8ef8ea833/application'],
  ['Ashby/MindRobotics', 'https://jobs.ashbyhq.com/mindrobotics/7a25a448-1da5-4e42-9e36-58dada498c15/application'],
  ['Workable/MistyWest', 'https://apply.workable.com/mistywest/j/6A55CD13CA/apply/'],
  ['Workable/Infleqtion', 'https://apply.workable.com/coldquanta/j/7B55D6B38F/apply/'],
  ['JazzHR/D3', 'https://d3engineering.applytojob.com/apply/i6V7yv845S/Staff-Embedded-Software-Engineer'],
  [
    'JazzHR/BlueVoyant',
    'https://bluevoyant.applytojob.com/apply/lO19ReceJ2/Back-End-Software-Engineer-Microsoft-Azure-Technologies',
  ],
  ['Jobvite/Reveal', 'https://jobs.jobvite.com/reveal/job/ocz0zfw4/apply'],
  ['Jobvite/Redwire', 'https://jobs.jobvite.com/edgeautonomy-careers/job/o91nAfwR/apply'],
  ['Recruitee/ScioTeq', 'https://scioteq.recruitee.com/o/development-engineer-embedded-software'],
  ['Recruitee/Freeday', 'https://freeday.recruitee.com/o/software-engineer-3'],
  ['Greenhouse/CLEAR', 'https://job-boards.greenhouse.io/clear/jobs/8043865'],
  ['Greenhouse/Axios', 'https://job-boards.greenhouse.io/axios/jobs/7818788'],
  ['Greenhouse/Ever', 'https://job-boards.greenhouse.io/ever/jobs/5064724008'],
  ['Breezy/Carnegie', 'https://carnegie-robotics.breezy.hr/p/2d85f5321cc7-software-engineer/apply'],
  [
    'SmartRec/Axiado',
    'https://jobs.smartrecruiters.com/Axiado/744000126414209-staff-firmware-engineer-nvidia-ecosystem-',
  ],
  ['Teamtailor/Hiire', 'https://hiire.teamtailor.com/jobs/7616389-embedded-software-engineer-security-focused'],
];

const FIELD =
  'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox], [class*=yesno]';

for (const [name, url] of URLS) {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  ctx.on('close', () => {});
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
      const val = (el) => {
        if (el.type === 'file') return el.files?.[0]?.name || '';
        if (el.matches('[class*=select__control],[class*=select__control] *')) return '';
        return (el.value || '').trim();
      };
      const texts = [
        ...document.querySelectorAll(
          'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]), textarea',
        ),
      ].filter((e) => !e.closest('.select__control'));
      const filledText = texts.filter((e) => (e.value || '').trim()).length;
      const rs = [...document.querySelectorAll('.select__control, [class*="select__control"]')];
      const filledRs = rs.filter((c) =>
        c.querySelector('.select__single-value, [class*=single-value]')?.textContent?.trim(),
      ).length;
      const files = [...document.querySelectorAll('input[type=file]')]
        .map((e) => e.files?.[0]?.name || '')
        .filter(Boolean);
      const checked =
        document.querySelectorAll('input:checked').length +
        [...document.querySelectorAll('[class*=yesno] button')].filter((b) => /_active|selected/i.test(b.className))
          .length;
      return {
        texts: `${filledText}/${texts.length}`,
        reactSelect: `${filledRs}/${rs.length}`,
        files: files.length,
        checked,
      };
    });
    console.log(
      `${name.padEnd(22)} text ${r.texts.padEnd(7)} rsel ${r.reactSelect.padEnd(6)} files ${r.files} checked ${r.checked}`,
    );
  } catch (e) {
    console.log(`${name.padEnd(22)} ERR ${String(e).slice(0, 70)}`);
  }
  await ctx.close();
}
console.log('BATCH DONE');
