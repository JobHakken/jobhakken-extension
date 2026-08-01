import { describe, expect, it } from '@jest/globals';

import { extractPdfText } from './pdfText';

const enc = (s: string) => new TextEncoder().encode(s);

/** A tiny uncompressed PDF whose one content stream shows `text`. */
function uncompressedPdf(text: string): Uint8Array {
  const content = `BT /F1 12 Tf (${text}) Tj ET`;
  return enc(
    `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n%%EOF`,
  );
}

describe('extractPdfText', () => {
  it('reads text from an uncompressed content stream (literal strings + escapes)', async () => {
    const t = await extractPdfText(uncompressedPdf('Jordan Rivera \\(Senior Engineer\\) — Globex'));
    expect(t).toContain('Jordan Rivera');
    expect(t).toContain('Senior Engineer');
    expect(t).toContain('Globex');
  });

  it('reads hex-string text', async () => {
    // <48656C6C6F> = "Hello"
    const bytes = enc('%PDF-1.4\n2 0 obj<</Length 20>>stream\nBT <48656C6C6F> Tj ET\nendstream endobj\n%%EOF');
    expect(await extractPdfText(bytes)).toContain('Hello');
  });

  it('returns empty for a PDF with no text streams', async () => {
    expect(await extractPdfText(enc('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'))).toBe('');
  });

  // NOTE: the FlateDecode path (DecompressionStream) is exercised in a real browser by
  // e2e/tools/pdf-upload-test.mjs — jsdom's Blob/stream plumbing can't inflate reliably.
});
