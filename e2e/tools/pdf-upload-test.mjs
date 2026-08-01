import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 900, height: 800 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const p = await ctx.newPage();
await p.goto(`chrome-extension://${extId}/options/options.html`);
await p.waitForTimeout(400);
// build a REAL FlateDecode PDF in the page (browser CompressionStream), set it on the file input
const result = await p.evaluate(async () => {
  const enc = (s) => new TextEncoder().encode(s);
  const content = 'BT /F1 12 Tf (Jordan Rivera - Senior Software Engineer at Globex Corp) Tj ET';
  const comp = new Uint8Array(
    await new Response(new Blob([enc(content)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  );
  const head = enc(`%PDF-1.4\n2 0 obj<</Length ${comp.length}/Filter/FlateDecode>>stream\n`);
  const tail = enc('\nendstream endobj\n%%EOF');
  const bytes = new Uint8Array(head.length + comp.length + tail.length);
  bytes.set(head, 0);
  bytes.set(comp, head.length);
  bytes.set(tail, head.length + comp.length);
  const file = new File([bytes], 'resume.pdf', { type: 'application/pdf' });
  const input = document.getElementById('resumePdf');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  return {
    textarea: document.getElementById('resumeText').value,
    status: (document.getElementById('resumeStatus').textContent || '').trim(),
  };
});
console.log('status:', result.status);
console.log('extracted textarea:', JSON.stringify(result.textarea));
console.log(
  result.textarea.includes('Jordan Rivera') && result.textarea.includes('Globex') ? 'PDF EXTRACTION ✓' : 'FAILED',
);
await ctx.close();
