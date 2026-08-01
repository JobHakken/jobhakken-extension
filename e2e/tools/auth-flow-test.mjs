import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import https from 'https';
import fs from 'fs';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const cert = fs.readFileSync('/tmp/jh-cert.pem'),
  key = fs.readFileSync('/tmp/jh-key.pem');
// a fake signed-in Supabase session, as the website would store it
const session = {
  access_token: 'test-access-token',
  refresh_token: 'rt-SECRET-should-not-leak',
  expires_at: 1893456000,
  user: { id: 'user-123', email: 'jordan.rivera@example.com', app_metadata: { tier: 'pro' } },
};
const page = (
  signedIn,
) => `<!doctype html><meta charset=utf8><title>JobHakken</title><body><h1>JobHakken login</h1><script>
  ${signedIn ? `localStorage.setItem('sb-abcdefgh-auth-token', ${JSON.stringify(JSON.stringify(session))});` : `localStorage.removeItem('sb-abcdefgh-auth-token');`}
</script></body>`;
let mode = 'in';
const srv = https
  .createServer({ cert, key }, (req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(page(mode === 'in'));
  })
  .listen(0);
const port = srv.address().port;
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  ignoreHTTPSErrors: true,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--ignore-certificate-errors',
    `--host-resolver-rules=MAP app.jobhakken.com:443 127.0.0.1:${port}`,
  ],
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 60000 }).catch(() => null);
for (let i = 0; i < 30 && !sw; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  sw = ctx.serviceWorkers()[0];
}
if (!sw) {
  console.log('NO SW');
  process.exit(1);
}
const readId = async () =>
  sw.evaluate(async () => (await chrome.storage.local.get('f2a_identity')).f2a_identity ?? null);
// 1) signed IN
const p = await ctx.newPage();
await p
  .goto('https://app.jobhakken.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 })
  .catch((e) => console.log('nav err', e.message.slice(0, 60)));
await p.waitForTimeout(2500);
let id = await readId();
console.log('after login → identity:', JSON.stringify(id));
console.log('  refresh token leaked?', JSON.stringify(id || {}).includes('rt-SECRET') ? 'YES (BUG)' : 'no ✓');
// 2) sign OUT (token removed) → next sync clears identity
mode = 'out';
await p.goto('https://app.jobhakken.com/account', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
await p.waitForTimeout(2500);
const id2 = await readId();
console.log('after logout → identity:', JSON.stringify(id2));
srv.close();
await ctx.close();
