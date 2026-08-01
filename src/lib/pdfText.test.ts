import { describe, expect, it } from '@jest/globals';

import { extractPdfText } from './pdfText';

const enc = (s: string) => new TextEncoder().encode(s);
const toHex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

/** Build an uncompressed single-content-stream PDF around `content` (with a correct /Length). */
function pdf(content: string): Uint8Array {
  const len = enc(content).length;
  return enc(
    `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Length ${len}>>stream\n${content}\nendstream endobj\n%%EOF`,
  );
}

describe('extractPdfText', () => {
  it('reads text from an uncompressed content stream (literal strings + escapes)', async () => {
    const t = await extractPdfText(pdf('BT /F1 12 Tf (Jordan Rivera \\(Senior Engineer\\) Globex Austin Texas) Tj ET'));
    expect(t).toContain('Jordan Rivera');
    expect(t).toContain('Senior Engineer'); // \( \) escapes unwrapped
    expect(t).toContain('Globex');
  });

  it('reads hex-string text', async () => {
    const t = await extractPdfText(pdf(`BT <${toHex('Resume of Jordan Rivera Senior Engineer Globex')}> Tj ET`));
    expect(t).toContain('Jordan Rivera Senior Engineer');
  });

  it('honors TJ kerning as word spaces (no glued/split words)', async () => {
    const tj = '[(Resume)-300(of)-300(Jordan)-300(Rivera)-300(Senior)-300(Engineer)-300(at)-300(Globex)]';
    const t = await extractPdfText(pdf(`BT /F1 12 Tf ${tj} TJ ET`));
    expect(t).toContain('Resume of Jordan Rivera Senior Engineer at Globex');
  });

  it('returns "" for a PDF with no text streams', async () => {
    expect(await extractPdfText(enc('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'))).toBe('');
  });

  it('returns "" (not garbage) when a content stream decodes to binary — the reported bug', async () => {
    // Control-byte "text" (glyph codes / undecoded stream) must be rejected, so the paste box never
    // fills with garbage. Codes 1..25 avoid ( ) \ so they need no escaping.
    const junk = Array.from({ length: 60 }, (_, i) => String.fromCharCode(1 + (i % 25))).join('');
    expect(await extractPdfText(pdf(`BT (${junk}) Tj ET`))).toBe('');
  });

  it('ignores non-content streams (no text-showing operators)', async () => {
    // A metadata-ish stream with parenthesized bytes but no Tj/TJ must not be scraped.
    expect(await extractPdfText(pdf('<< /Producer (Acme) /Author (nobody) >>'))).toBe('');
  });

  // NOTE: the FlateDecode + /ToUnicode CID path (DecompressionStream) is validated against REAL
  // résumé PDFs (Word/Google-Docs subset fonts) manually + by e2e/tools/pdf-upload-test.mjs — jsdom's
  // Blob/stream plumbing can't inflate reliably, so it isn't exercised here.
});
