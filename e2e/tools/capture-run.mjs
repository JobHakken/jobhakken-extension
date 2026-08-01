// Human-in-the-loop capture: opens a VISIBLE browser at a gated ATS, waits for you to clear the gate
// (captcha / login), then captures the form as a fixture + runs autofill to prove coverage.
// Never submits the application. Usage:
//   PWHEAD=1 CAP_URL=<gate url> CAP_EMAIL=<temp> CAP_NAME=icims node e2e/tools/capture-run.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const CAP_URL = process.env.CAP_URL;
const CAP_EMAIL = process.env.CAP_EMAIL || '';
const NAME = process.env.CAP_NAME || 'capture';
const PROFILE = process.env.CAP_PROFILE || `/tmp/cap/${NAME}`;
const OUT = process.env.CAP_OUT || `/tmp/${NAME}-form.html`;
const WAIT_MIN = Number(process.env.CAP_WAIT_MIN || 8);

// Headed (visible) so the human can act. Do NOT add --headless.
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--disable-blink-features=AutomationControlled',
    '--start-maximized',
  ],
  viewport: null,
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
const extId = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true })).catch(() => {});
await cfg.close();

const p = await ctx.newPage();
const bestFrame = async () =>
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

console.log('→ opening', CAP_URL);
await p.goto(CAP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await p.waitForTimeout(4000);

// Per-ATS pre-fill of the non-captcha gate bits, to minimise what the human does.
if (NAME === 'icims') {
  await p
    .locator('#email, input[name="css_loginName"]')
    .first()
    .fill(CAP_EMAIL)
    .catch(() => {});
  await p
    .locator('#accept_privacy, input[name="accept_privacy"]')
    .first()
    .check()
    .catch(() => {});
  console.log('\n================ ACTION NEEDED ================');
  console.log('A browser window is open on the iCIMS page.');
  console.log('Email + privacy are pre-filled. Please:');
  console.log('  1) Solve the CAPTCHA');
  console.log('  2) Click the submit/continue button');
  console.log(`Waiting up to ${WAIT_MIN} min for the application form to load…`);
  console.log('===============================================\n');
} else if (NAME === 'smartrec') {
  // SmartRecruiters: the apply form (with its captcha) is behind an "I'm interested" click.
  await p
    .getByText(/I'?m interested/i)
    .first()
    .click({ timeout: 6000 })
    .catch(() => {});
  await p.waitForTimeout(6000);
  await p
    .locator('#email, input[type="email"], input[name*="mail" i]')
    .first()
    .fill(CAP_EMAIL)
    .catch(() => {});
  console.log('\n================ ACTION NEEDED ================');
  console.log('A browser window is open on the SmartRecruiters apply page.');
  console.log(`Email attempted: ${CAP_EMAIL} (type it if the field is empty).`);
  console.log('Please: fill any name/email fields shown, SOLVE THE CAPTCHA, and continue to the form.');
  console.log(`Waiting up to ${WAIT_MIN} min for the application form to load…`);
  console.log('===============================================\n');
} else if (NAME === 'oracle') {
  console.log('\n================ ACTION NEEDED ================');
  console.log('A browser window is open on the Oracle apply page. Please:');
  console.log(`  1) Type this email:  ${CAP_EMAIL}`);
  console.log('  2) Tick "I agree with the terms and conditions"');
  console.log('  3) Click NEXT  (no captcha — just these 3 steps)');
  console.log(`Waiting up to ${WAIT_MIN} min for the application form to load…`);
  console.log('===============================================\n');
} else {
  console.log('\n================ ACTION NEEDED ================');
  console.log('A browser window is open. Please clear the gate (captcha / email / login).');
  console.log(`Waiting up to ${WAIT_MIN} min for the application form to load…`);
  console.log('===============================================\n');
}

// Poll until the form frame shows a healthy field count (human cleared the gate).
const deadline = Date.now() + WAIT_MIN * 60_000;
let tgt = null;
while (Date.now() < deadline) {
  tgt = await bestFrame().catch(() => null);
  if (tgt && tgt.total >= 5) break;
  await new Promise((r) => setTimeout(r, 4000));
}
if (!tgt || tgt.total < 5) {
  console.log('TIMED OUT waiting for the form (total:', tgt?.total ?? 0, '). Leaving the window open 60s.');
  await p.waitForTimeout(60_000);
  await ctx.close();
  process.exit(0);
}

console.log('FORM REACHED — fields:', JSON.stringify(tgt));
// Capture the fixture from the FRAME that actually holds the form (ATS SPAs like iCIMS render the
// application inside a child iframe, so the top frame's outerHTML would miss it). Pick the frame with
// the most fillable inputs.
const { writeFileSync } = await import('fs');
let formFrame = p.mainFrame(),
  maxN = -1;
for (const f of p.frames()) {
  const n = await f
    .evaluate(() => document.querySelectorAll('input:not([type=hidden]),select,textarea').length)
    .catch(() => -1);
  if (n > maxN) {
    maxN = n;
    formFrame = f;
  }
}
const html = await formFrame.evaluate(() => document.documentElement.outerHTML).catch(() => '');
writeFileSync(OUT, html);
console.log(
  'CAPTURED form →',
  OUT,
  `(${html.length} bytes, frame fields=${maxN}, url=${formFrame.url().slice(0, 60)})`,
);

// Prove the engine fills it
const r = await sw.evaluate(
  async (t) =>
    new Promise((res) => {
      chrome.tabs.sendMessage(
        t.tabId,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'demo' } },
        { frameId: t.frameId },
        (x) => res(chrome.runtime.lastError ? { err: chrome.runtime.lastError.message } : x),
      );
      setTimeout(() => res({ err: 'timeout' }), 120000);
    }),
  tgt,
);
console.log('AUTOFILL RESULT:', JSON.stringify(r));
await p.waitForTimeout(2000);
const dump = await p
  .evaluate(() =>
    [...document.querySelectorAll('input,select,textarea')]
      .filter((e) => e.offsetParent && e.type !== 'hidden' && e.type !== 'file')
      .map((e) => ({
        l: (e.labels?.[0]?.textContent || e.getAttribute('aria-label') || e.name || e.placeholder || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 28),
        v: (e.value || '').slice(0, 22),
      }))
      .filter((x) => x.l)
      .slice(0, 30),
  )
  .catch(() => []);
for (const f of dump) console.log(`   ${f.l.padEnd(30)} = ${JSON.stringify(f.v)}`);
console.log('\nDONE — review the filled form in the window (nothing submitted). Closing in 30s.');
await p.waitForTimeout(30_000);
await ctx.close();
