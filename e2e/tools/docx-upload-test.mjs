import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 900, height: 1000 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const p = await ctx.newPage();
await p.goto(`chrome-extension://${extId}/options/options.html`);
await p.waitForTimeout(400);
await p.locator('#resumeAi > summary').click();
await p.waitForTimeout(300);
// build a REAL compressed (deflate-raw) .docx in-page and feed it to the upload input
const res = await p.evaluate(async () => {
  const enc = (s) => new TextEncoder().encode(s);
  const xml =
    '<w:document><w:body><w:p><w:r><w:t>Jordan Rivera</w:t></w:r></w:p><w:p><w:r><w:t>Senior Software Engineer at Globex Corp</w:t></w:r></w:p><w:p><w:r><w:t>BS Computer Science, UT Austin</w:t></w:r></w:p></w:body></w:document>';
  const data = enc(xml);
  const comp = new Uint8Array(
    await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
  );
  const fn = enc('word/document.xml');
  const total = 30 + fn.length + comp.length + (46 + fn.length) + 22;
  const b = new Uint8Array(total);
  const d = new DataView(b.buffer);
  let o = 0;
  const w16 = (v) => {
      d.setUint16(o, v, true);
      o += 2;
    },
    w32 = (v) => {
      d.setUint32(o, v, true);
      o += 4;
    };
  w32(0x04034b50);
  w16(20);
  w16(0);
  w16(8);
  w16(0);
  w16(0);
  w32(0);
  w32(comp.length);
  w32(data.length);
  w16(fn.length);
  w16(0);
  b.set(fn, o);
  o += fn.length;
  b.set(comp, o);
  o += comp.length;
  const cdOff = o;
  w32(0x02014b50);
  w16(20);
  w16(20);
  w16(0);
  w16(8);
  w16(0);
  w16(0);
  w32(0);
  w32(comp.length);
  w32(data.length);
  w16(fn.length);
  w16(0);
  w16(0);
  w16(0);
  w16(0);
  w32(0);
  w32(0);
  b.set(fn, o);
  o += fn.length;
  const cdSize = o - cdOff;
  w32(0x06054b50);
  w16(0);
  w16(0);
  w16(1);
  w16(1);
  w32(cdSize);
  w32(cdOff);
  w16(0);
  const file = new File([b], 'resume.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('resumePdf');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  return {
    status: (document.getElementById('resumeStatus').textContent || '').trim(),
    text: document.getElementById('resumeText').value,
  };
});
console.log('DOCX status:', res.status);
console.log('extracted:', JSON.stringify(res.text.slice(0, 90)));
console.log(res.text.includes('Jordan Rivera') && res.text.includes('Globex') ? 'DOCX EXTRACTION ✓' : 'FAILED');
await p.evaluate(() => document.querySelector('.tab[data-t="desktop"]') && null);
await p.screenshot({ path: '/tmp/shots/resume-upload-ui.png', fullPage: false });
await ctx.close();
