import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const JOBS = [
  ['Ashby·Replit', 'https://jobs.ashbyhq.com/replit/47235851-fadd-4bd7-9cc6-61f545059ac1/application', null],
  ['Lever·Flex', 'https://jobs.lever.co/Flex/151e09c6-398f-4fe0-8da7-8fd7814d1bae/apply', null],
  ['Recruitee·1X', 'https://1x.recruitee.com/o/full-stack-engineer-manufacturing-data-platform/c/new', null],
  [
    'Teamtailor·Multiverse',
    'https://multiversecomputing.teamtailor.com/jobs/8129651-senior-software-engineer',
    'Apply for this job',
  ],
  [
    'SmartRec·Mirantis',
    'https://jobs.smartrecruiters.com/Mirantis/744000139667249-software-engineer-infrastructure-go-remote-in-the-us',
    "I'?m interested",
  ],
  ['Greenhouse·DoorDash', 'https://job-boards.greenhouse.io/doordashusa/jobs/7263610', null],
];
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
const NEUTRALIZE_AND_SUBMIT = () => {
  document.querySelectorAll('form').forEach((f) =>
    f.addEventListener(
      'submit',
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    ),
  );
  try {
    HTMLFormElement.prototype.submit = function () {};
    HTMLFormElement.prototype.requestSubmit = function () {};
  } catch {}
  document.querySelectorAll('button[type=submit],input[type=submit],button:not([type])').forEach((b) => {
    try {
      b.click();
    } catch {}
  });
  return true;
};
const COLLECT = () => {
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const lbl = (el) => {
    if (el.getAttribute && el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    const id = el.id;
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l) return txt(l);
    }
    const w = el.closest && el.closest('label');
    if (w) return txt(w);
    let n = el.closest && el.closest('div,li,fieldset,section');
    for (let i = 0; i < 4 && n; i++) {
      const t = txt(n.querySelector('label,legend,.select__label,.text,[class*=label],h3,h4'));
      if (t && t.length < 120) return t;
      n = n.parentElement;
    }
    return el.name || el.placeholder || '?';
  };
  const flagged = new Set();
  // 1. native constraint validation
  document.querySelectorAll('input,select,textarea').forEach((el) => {
    const t = (el.type || '').toLowerCase();
    if (t === 'hidden') return;
    if (el.matches && el.matches(':invalid')) flagged.add(lbl(el).slice(0, 56));
  });
  // 2. aria-invalid set by the form's own validator
  document.querySelectorAll('[aria-invalid="true"]').forEach((el) => flagged.add(lbl(el).slice(0, 56)));
  // 3. visible error-message blocks → resolve to the question label in the same container
  document.querySelectorAll('[role=alert],[class*=error],[class*=Error],[class*=invalid],.field-error').forEach((e) => {
    if (e.matches('input,select,textarea')) return;
    if (e.offsetParent === null) return;
    const t = txt(e);
    if (t.length < 3 || t.length > 120) return;
    const cont = e.closest('div,li,fieldset');
    const q = cont?.querySelector('label,.select__label,legend,[class*=label]');
    flagged.add((q ? txt(q) : t).replace(/\*/g, '').trim().slice(0, 56));
  });
  return [...flagged].filter(Boolean);
};
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
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
await cfg.close();
for (const [name, url, applyText] of JOBS) {
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    await clearFrames(sw);
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p
      .getByRole('button', { name: /accept|agree|got it|allow all/i })
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    if (applyText) {
      await p
        .getByText(new RegExp(applyText, 'i'))
        .first()
        .click({ timeout: 8000 })
        .catch(() => {});
      await p.waitForTimeout(2500);
    }
    let tgt = null;
    for (let i = 0; i < 18; i++) {
      await p.waitForTimeout(1000);
      tgt = await readTgt(sw);
      if (tgt && tgt.total >= 3) break;
    }
    if (!tgt) {
      console.log(`\n### ${name}: NO FORM`);
      await p.close();
      continue;
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
    await p.waitForTimeout(2500);
    await p.route('**/*', (r) => {
      if (r.request().method() !== 'GET') return r.abort();
      return r.continue();
    });
    for (const fr of p.frames()) {
      try {
        await fr.evaluate(NEUTRALIZE_AND_SUBMIT);
      } catch {}
    }
    await p.waitForTimeout(1800);
    let flagged = [];
    for (const fr of p.frames()) {
      try {
        flagged = flagged.concat(await fr.evaluate(COLLECT));
      } catch {}
    }
    flagged = [...new Set(flagged)];
    console.log(`\n### ${name} — form rejects ${flagged.length} field(s) after autofill:`);
    for (const f of flagged) console.log(`   ✗ ${f}`);
  } catch (e) {
    console.log(`\n### ${name}: ERROR ${String(e.message).slice(0, 50)}`);
  }
  await p.close();
}
await ctx.close();
console.log('\nPROBE DONE');
