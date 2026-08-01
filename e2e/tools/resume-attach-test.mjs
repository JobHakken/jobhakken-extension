import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
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
// seed: profile (standalone, no desktop) + a stored résumé FILE
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(async () => {
  await chrome.storage.local.set({
    f2a_test_mode: false,
    f2a_full_profile: {
      profile: {
        firstName: 'Jordan',
        lastName: 'Rivera',
        fullName: 'Jordan Alex Rivera',
        email: 'jordan.rivera@example.com',
        phone: '(201) 555-0123',
      },
      experience: [],
      education: [],
      rules: [],
    },
    f2a_resume_file: {
      base64: btoa('%PDF-1.4 fake resume bytes\n%%EOF'),
      fileName: 'jordan-rivera-resume.pdf',
      mimeType: 'application/pdf',
    },
  });
});
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
await sw.evaluate(
  async (t) =>
    new Promise((res) => {
      chrome.tabs.sendMessage(
        t.tabId,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'demo' } },
        { frameId: t.frameId },
        res,
      );
      setTimeout(res, 60000);
    }),
  tgt,
);
await p.waitForTimeout(3000);
const attached = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('input[type=file]').forEach((i) => {
    if (i.files && i.files.length) out.push(i.files[0].name);
  });
  return out;
});
console.log('résumé file inputs with a file attached:', JSON.stringify(attached));
console.log(attached.some((n) => /jordan-rivera-resume/.test(n)) ? 'RÉSUMÉ ATTACHED (standalone) ✓' : 'NOT attached');
await ctx.close();
