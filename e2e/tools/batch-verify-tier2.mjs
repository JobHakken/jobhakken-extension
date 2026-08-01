// Tier 2 (enterprise, login/account-gated) reachability sweep — what's fillable BEFORE auth.
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '../../dist');
const URLS = [
  [
    'Workday/Comcast',
    'https://comcast.wd5.myworkdayjobs.com/en-US/Comcast_Careers/job/Lead-Software-Engineer--AI----Onsite---Reston--VA---Freewheel_R440252',
  ],
  [
    'Workday/NGC',
    'https://ngc.wd1.myworkdayjobs.com/en-US/Northrop_Grumman_External_Site/job/Embedded-Software-Engineer_R10239701',
  ],
  ['iCIMS/Markon', 'https://careers-markon.icims.com/jobs/8403/software-engineer-level-0/login?in_iframe=1'],
  [
    'Oracle/Fortive',
    'https://ejta.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/9491/apply/email?src=300000219069438',
  ],
  ['Dayforce/York', 'https://jobs.dayforcehcm.com/en-US/yss/candidateportal/jobs/2488'],
  ['Taleo/Kearney', 'https://kearney.taleo.net/careersection/051/jobdetail.ftl?job=006AA'],
  [
    'BrassRing/GA',
    'https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?PageType=JobDetails&jobid=5221725&partnerid=25539&siteid=5313',
  ],
  ['Paycom/SrSWE', 'https://paycomonline.net/v4/ats/web.php/portal/3e64d01d9950e486d4a0fe9c96454c82/jobs/461497'],
];
const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox]';
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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4000);
    // try clicking Apply/I'm interested to advance toward the form
    if (
      (await page
        .locator(FIELD)
        .count()
        .catch(() => 0)) < 2
    ) {
      const b = page
        .getByRole('button', { name: /apply|i'?m interested|start|continue/i })
        .or(page.getByRole('link', { name: /apply/i }))
        .first();
      if (await b.count().catch(() => 0)) {
        await b.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3500);
      }
    }
    const reach = await page.evaluate(() => {
      const fields = document.querySelectorAll(
        'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox]',
      ).length;
      const gate = /sign in|log in|create account|new user|verify your email|password/i.test(
        document.body.innerText || '',
      );
      return { fields, gate };
    });
    for (let i = 0; i < 3; i++) {
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
    const filled = await page.evaluate(
      () =>
        [
          ...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea'),
        ].filter((e) => (e.value || '').trim()).length,
    );
    console.log(
      `${name.padEnd(20)} fields ${String(reach.fields).padEnd(4)} filled ${String(filled).padEnd(3)} ${reach.gate ? 'LOGIN-GATE' : ''}`,
    );
  } catch (e) {
    console.log(`${name.padEnd(20)} ERR ${String(e).slice(0, 60)}`);
  }
  await ctx.close();
}
console.log('TIER2 DONE');
