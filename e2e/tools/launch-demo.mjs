import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import fs from 'fs';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const env = fs.readFileSync('/Users/mighty/Documents/github/job/plans-and-thoughts/site/.env', 'utf8');
const apiKey = (env.match(/^LLM_API_KEY=(.+)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '');
const PROFILE = {
  profile: {
    firstName: 'Jordan',
    middleName: 'Alex',
    lastName: 'Rivera',
    fullName: 'Jordan Alex Rivera',
    preferredName: 'Jordan',
    email: 'jordan.rivera@example.com',
    phone: '(201) 555-0123',
    city: 'Austin',
    state: 'TX',
    country: 'United States',
    location: 'Austin, TX',
    linkedin: 'https://www.linkedin.com/in/jordan-rivera',
    github: 'https://github.com/jordan-rivera',
    website: 'https://jordanrivera.dev',
    currentTitle: 'Senior Software Engineer',
    currentCompany: 'Globex Corp',
    yearsExperience: '6',
    workAuthorization: 'Yes',
    requiresSponsorship: 'No',
    salaryExpectation: '150,000 USD',
    gender: 'Prefer not to say',
    pronouns: 'they/them',
    raceEthnicity: 'Prefer not to say',
    hispanicLatino: 'No',
    veteranStatus: 'I am not a protected veteran',
    disabilityStatus: 'No, I do not have a disability',
  },
  experience: [
    {
      position: 'Senior Software Engineer',
      company: 'Globex Corp',
      highlights: ['Led a payments platform serving 5M users', 'Cut deploy time 40%'],
    },
  ],
  education: [{ degree: 'BS', fieldOfStudy: 'Computer Science', school: 'The University of Texas at Austin' }],
  rules: [],
};
const clearFrames = async (sw) =>
  sw.evaluate(async () => {
    const s = await chrome.storage.session.get(null);
    for (const k of Object.keys(s)) if (k.startsWith('f2a_frames:')) await chrome.storage.session.remove(k);
  });
const readTgt = async (sw) =>
  sw.evaluate(async () => {
    const s = await chrome.storage.session.get(null);
    let t = null;
    for (const [k, c] of Object.entries(s)) {
      if (!k.startsWith('f2a_frames:')) continue;
      const id = Number(k.split(':')[1]);
      let b = null;
      for (const [f, n] of Object.entries(c)) if (n > 0 && (!b || n > b.count)) b = { frameId: Number(f), count: n };
      const tot = Object.values(c).reduce((a, x) => a + x, 0);
      if (b && (!t || tot > t.total)) t = { tabId: id, frameId: b.frameId, total: tot };
    }
    return t;
  });
const rpc = (sw, t, m) =>
  sw.evaluate(
    async (a) =>
      new Promise((res) => {
        chrome.tabs.sendMessage(
          a.tabId,
          { type: 'f2a-rpc', method: a.m, params: { mode: 'demo' } },
          { frameId: a.frameId },
          (x) => res(x),
        );
        setTimeout(() => res({ err: 'to' }), 70000);
      }),
    { ...t, m },
  );
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--disable-blink-features=AutomationControlled',
    '--window-size=1400,1000',
  ],
  viewport: null,
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(
  async (a) => {
    await chrome.storage.local.set({
      f2a_full_profile: a.p,
      f2a_test_mode: false,
      f2a_ai_cfg: { model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
    });
    if (a.k) await chrome.storage.session.set({ f2a_ai_key: a.k });
  },
  { p: PROFILE, k: apiKey },
);
await cfg.close();
const p = await ctx.newPage();
await clearFrames(sw);
await p.goto('https://jobs.ashbyhq.com/replit/47235851-fadd-4bd7-9cc6-61f545059ac1/application', {
  waitUntil: 'domcontentloaded',
  timeout: 45000,
});
let tgt = null;
for (let i = 0; i < 20; i++) {
  await p.waitForTimeout(1000);
  tgt = await readTgt(sw);
  if (tgt && tgt.total >= 3) break;
}
const t0 = Date.now();
const a = await rpc(sw, tgt, 'autofill');
console.log('autofill:', a?.filled, '/', tgt.total, 'fields ·', ((Date.now() - t0) / 1000).toFixed(1) + 's');
const t1 = Date.now();
const d = await rpc(sw, tgt, 'draft');
console.log('AI draft:', JSON.stringify(d), '·', ((Date.now() - t1) / 1000).toFixed(1) + 's');
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/shots/demo-filled.png', fullPage: true }).catch(() => {});
console.log('DEMO READY — screenshot saved; window stays open 15 min for you to scroll/inspect.');
await new Promise((r) => setTimeout(r, 900000));
await ctx.close();
