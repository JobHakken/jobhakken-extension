import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import http from 'http';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
// ── mock OpenAI-compatible server: returns a JSON array of answers, logs each call ──
let calls = 0,
  lastQuestions = 0;
const srv = http
  .createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 404;
      return res.end('x');
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      calls++;
      let n = 1;
      try {
        const j = JSON.parse(body);
        const user = j.messages?.find((m) => m.role === 'user')?.content || '';
        n = (user.match(/^\d+\. /gm) || []).length || 1;
        lastQuestions = n;
      } catch {}
      const answers = Array.from(
        { length: n },
        (_, i) =>
          `Mock AI answer #${i + 1}: I'm genuinely excited about this role — my backend platform work maps directly to what you need.`,
      );
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(answers) } }],
          usage: { prompt_tokens: 820, completion_tokens: 60 * n },
        }),
      );
    });
  })
  .listen(0);
const port = srv.address().port;
console.log('mock LLM on 127.0.0.1:' + port);
const PROFILE = {
  profile: {
    firstName: 'Jordan',
    lastName: 'Rivera',
    fullName: 'Jordan Alex Rivera',
    preferredName: 'Jordan',
    email: 'jordan.rivera@example.com',
    phone: '(201) 555-0123',
    location: 'Austin, TX',
    currentTitle: 'Senior Engineer',
    currentCompany: 'Globex Corp',
    yearsExperience: '6',
    linkedin: 'https://www.linkedin.com/in/jordan-rivera',
    github: 'https://github.com/jordan-rivera',
    website: 'https://jordanrivera.dev',
  },
  experience: [{ title: 'Senior Engineer', company: 'Globex Corp', summary: 'Led backend platform + CI/CD' }],
  education: [{ degree: 'BS', fieldOfStudy: 'Computer Science', school: 'UT Austin' }],
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
const rpc = (sw, tgt, method) =>
  sw.evaluate(
    async (a) =>
      new Promise((res) => {
        chrome.tabs.sendMessage(
          a.tabId,
          { type: 'f2a-rpc', method: a.method, params: { mode: 'demo' } },
          { frameId: a.frameId },
          (x) => res(x),
        );
        setTimeout(() => res({ err: 'to' }), 60000);
      }),
    { ...tgt, method },
  );
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--disable-blink-features=AutomationControlled',
  ],
  viewport: { width: 1280, height: 1400 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
// seed profile + BYO AI config (key in session, cfg in local) via the options page — Demo mode OFF
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(
  async (a) => {
    await chrome.storage.local.set({
      f2a_full_profile: a.profile,
      f2a_test_mode: false,
      f2a_ai_cfg: { model: 'mock-model', baseUrl: a.base },
    });
    await chrome.storage.session.set({ f2a_ai_key: 'mock-key' });
  },
  { profile: PROFILE, base: `http://127.0.0.1:${port}/v1` },
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
console.log('1) deterministic autofill…');
const a = await rpc(sw, tgt, 'autofill');
console.log('   filled', a?.filled, '/', tgt.total);
console.log('2) AI draft via BYO key → mock LLM (Demo mode OFF)…');
const d = await rpc(sw, tgt, 'draft');
console.log('   draft result:', JSON.stringify(d));
await p.waitForTimeout(1500);
const areas = await p.evaluate(() =>
  [...document.querySelectorAll('textarea')]
    .filter((t) => t.name !== 'g-recaptcha-response')
    .map((t) => ({
      q: (t.closest('div,li')?.querySelector('label,[class*=label]')?.textContent || t.name || '?')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50),
      val: t.value.replace(/\s+/g, ' ').slice(0, 80),
    })),
);
console.log('\n   DRAFTED ESSAYS:');
areas.forEach((t) => console.log(`   • "${t.q}"\n       → ${t.val || '(empty)'}`));
console.log(
  `\n   ⇒ mock LLM received ${calls} call(s) for ${lastQuestions} question(s)  ← batching: ${calls === 1 ? 'ONE call ✓' : calls + ' calls'}`,
);
await p.screenshot({ path: '/tmp/shots/byo-ai.png', fullPage: true }).catch(() => {});
srv.close();
await ctx.close();
