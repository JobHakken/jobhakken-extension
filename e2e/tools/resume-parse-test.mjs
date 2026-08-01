import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import http from 'http';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
let calls = 0;
const srv = http
  .createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      calls++;
      const profile = {
        firstName: 'Jordan',
        lastName: 'Rivera',
        fullName: 'Jordan Rivera',
        email: 'jordan.rivera@example.com',
        phone: '(201) 555-0123',
        location: 'Austin, TX',
        linkedin: 'https://linkedin.com/in/jordan-rivera',
        currentTitle: 'Senior Software Engineer',
        currentCompany: 'Globex Corp',
        yearsExperience: '6',
      };
      const content = JSON.stringify({
        profile,
        experience: [
          {
            position: 'Senior Software Engineer',
            company: 'Globex Corp',
            period: '2020–2025',
            description: 'Led payments platform',
          },
        ],
        education: [{ degree: 'BS', fieldOfStudy: 'Computer Science', school: 'UT Austin', period: '2014–2018' }],
      });
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1200, completion_tokens: 180 } }),
      );
    });
  })
  .listen(0);
const port = srv.address().port;
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 900, height: 1000 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const p = await ctx.newPage();
await p.goto(`chrome-extension://${extId}/options/options.html`);
// set BYO key + config (mock) — no desktop
await p.evaluate(
  async (a) => {
    await chrome.storage.local.set({ f2a_ai_cfg: { model: 'mock', baseUrl: a.base } });
    await chrome.storage.session.set({ f2a_ai_key: 'mock-key' });
  },
  { base: `http://127.0.0.1:${port}/v1` },
);
await p.reload();
await p.waitForTimeout(600);
// open the résumé block, paste text, click parse
await p.locator('#resumeAi > summary').click();
await p
  .locator('#resumeText')
  .fill(
    'JORDAN RIVERA\nSenior Software Engineer — Globex Corp (2020–2025)\nAustin, TX · jordan.rivera@example.com\nBS Computer Science, UT Austin\nLed the payments platform serving 5M users.',
  );
await p.locator('#resumeParse').click();
await p.waitForTimeout(2500);
const status = await p.locator('#resumeStatus').textContent();
console.log('status:', (status || '').trim());
console.log('mock calls:', calls);
// read the saved profile + a couple rendered inputs
const saved = await p.evaluate(async () => {
  const s = await chrome.storage.local.get('f2a_full_profile');
  return s.f2a_full_profile;
});
console.log(
  'saved profile fields:',
  Object.keys(saved?.profile || {}).length,
  '· experience:',
  saved?.experience?.length,
  '· education:',
  saved?.education?.length,
);
console.log(
  '  firstName=',
  saved?.profile?.firstName,
  '| email=',
  saved?.profile?.email,
  '| title=',
  saved?.profile?.currentTitle,
);
await p.screenshot({ path: '/tmp/shots/resume-parse.png', fullPage: true }).catch(() => {});
srv.close();
await ctx.close();
