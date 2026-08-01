import { describe, expect, it } from '@jest/globals';

import { extractPdfText } from './pdfText';

const enc = (s: string) => new TextEncoder().encode(s);
const toHex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
const u16 = (c: string) => c.charCodeAt(0).toString(16).padStart(4, '0');

/** Build an uncompressed single-content-stream PDF around `content` (with a correct /Length). */
function pdf(content: string): Uint8Array {
  const len = enc(content).length;
  return enc(
    `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Length ${len}>>stream\n${content}\nendstream endobj\n%%EOF`,
  );
}

/** Build a PDF from string + binary parts (for a real FlateDecode stream). */
function bytes(...parts: (string | Uint8Array)[]): Uint8Array {
  const chunks = parts.map((p) => (typeof p === 'string' ? enc(p) : p));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
async function deflate(s: string): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const buf = await new Response(new Blob([enc(s)]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}

describe('extractPdfText — ASCII / layout', () => {
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
    expect(t).not.toContain('Resumeof'); // small kern (-50) would NOT add a space; -300 does
  });

  it('a small TJ kern does NOT insert a space (keeps a word intact)', async () => {
    const t = await extractPdfText(pdf(`BT /F1 12 Tf [(Wo)-40(rk)-40(day)] TJ (of Jordan Rivera Senior) Tj ET`));
    expect(t).toContain('Workday'); // -40 kern < 120 threshold → no space
  });
});

describe('extractPdfText — CID subset fonts via /ToUnicode (the Word/Google-Docs case)', () => {
  /** A PDF whose text is 2-byte CID codes decoded through an (uncompressed) ToUnicode CMap:
   *  code i+1 → text[i]. This is the shape that produced garbage before the fix. */
  function cidPdf(text: string, opts: { perGlyphTm?: boolean } = {}): Uint8Array {
    const bfchar = [...text].map((c, i) => `<${u16(String.fromCharCode(i + 1))}> <${u16(c)}>`).join('\n');
    const cmap = `/CIDInit /ProcSet findresource begin\nbegincmap\nbeginbfchar\n${bfchar}\nendbfchar\nendcmap\nend`;
    const show = opts.perGlyphTm
      ? [...text].map((_, i) => `1 0 0 1 ${i * 6} 700 Tm <${u16(String.fromCharCode(i + 1))}> Tj`).join('\n') // each glyph its own Tm, same Y
      : `<${[...text].map((_, i) => u16(String.fromCharCode(i + 1))).join('')}> Tj`;
    const content = `BT /F1 12 Tf ${show} ET`;
    return enc(
      `%PDF-1.4\n1 0 obj<</Length ${enc(cmap).length}>>stream\n${cmap}\nendstream endobj\n` +
        `2 0 obj<</Length ${enc(content).length}>>stream\n${content}\nendstream endobj\n%%EOF`,
    );
  }

  it('decodes 2-byte CID codes through the ToUnicode map', async () => {
    const t = await extractPdfText(cidPdf('Jordan Rivera Senior Engineer at Globex'));
    expect(t).toContain('Jordan Rivera Senior Engineer at Globex');
  });

  it('does NOT split per-glyph-positioned CID text (the Tm-per-glyph bug)', async () => {
    // Every glyph gets its own Tm at the SAME y → must stay one line, not "N a m e".
    const t = await extractPdfText(cidPdf('Sayali Vinay Gadre resume here', { perGlyphTm: true }));
    expect(t).toContain('Sayali Vinay Gadre resume here');
  });

  it('decodes a ToUnicode bfrange ARRAY (<lo> <hi> [<u0><u1>…]) — the common Word/Docs form', async () => {
    const text = 'Resume data goes here now';
    const dsts = [...text].map((c) => `<${u16(c)}>`).join('');
    const cmap = `begincmap\nbeginbfrange\n<0001> <${u16(String.fromCharCode(text.length))}> [${dsts}]\nendbfrange\nendcmap`;
    const codes = [...text].map((_, i) => u16(String.fromCharCode(i + 1))).join('');
    const content = `BT <${codes}> Tj ET`;
    const bin = enc(
      `%PDF-1.4\n1 0 obj<</Length ${enc(cmap).length}>>stream\n${cmap}\nendstream endobj\n` +
        `2 0 obj<</Length ${enc(content).length}>>stream\n${content}\nendstream endobj\n%%EOF`,
    );
    expect(await extractPdfText(bin)).toContain('Resume data goes here now');
  });

  it('decodes a ToUnicode bfrange CONTIGUOUS range (<lo> <hi> <dst>)', async () => {
    // codes 1..26 → a..z (contiguous), code 27 → space (bfchar).
    const cmap =
      `begincmap\nbeginbfrange\n<0001> <001a> <0061>\nendbfrange\n` + `beginbfchar\n<001b> <0020>\nendbfchar\nendcmap`;
    const text = 'resume data goes here now please';
    const codes = [...text].map((c) => u16(String.fromCharCode(c === ' ' ? 27 : c.charCodeAt(0) - 0x60))).join('');
    const content = `BT <${codes}> Tj ET`;
    const bin = enc(
      `%PDF-1.4\n1 0 obj<</Length ${enc(cmap).length}>>stream\n${cmap}\nendstream endobj\n` +
        `2 0 obj<</Length ${enc(content).length}>>stream\n${content}\nendstream endobj\n%%EOF`,
    );
    expect(await extractPdfText(bin)).toContain('resume data goes here now please');
  });
});

describe('extractPdfText — FlateDecode (real DecompressionStream)', () => {
  it('inflates a FlateDecode content stream and extracts its text', async () => {
    const content = 'BT /F1 12 Tf (Jordan Rivera Senior Engineer Globex Austin Texas today) Tj ET';
    const zip = await deflate(content);
    const pdfBytes = bytes(
      `%PDF-1.4\n1 0 obj<</Filter/FlateDecode/Length ${zip.length}>>stream\n`,
      zip,
      `\nendstream endobj\n%%EOF`,
    );
    const t = await extractPdfText(pdfBytes);
    expect(t).toContain('Jordan Rivera Senior Engineer');
  });
});

describe('extractPdfText — robustness / the reported garbage bug', () => {
  it('returns "" for a PDF with no text streams', async () => {
    expect(await extractPdfText(enc('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'))).toBe('');
  });

  it('returns "" (not garbage) when a content stream decodes to binary — the reported bug', async () => {
    const junk = Array.from({ length: 60 }, (_, i) => String.fromCharCode(1 + (i % 25))).join('');
    expect(await extractPdfText(pdf(`BT (${junk}) Tj ET`))).toBe('');
  });

  it('ignores non-content streams (no text-showing operators)', async () => {
    expect(await extractPdfText(pdf('<< /Producer (Acme) /Author (nobody) >>'))).toBe('');
  });

  it('unescapes octal escapes in literal strings (\\101 = "A")', async () => {
    const t = await extractPdfText(pdf('BT (\\101pplied to Jordan Rivera Senior Engineer roles) Tj ET'));
    expect(t).toContain('Applied to Jordan Rivera');
  });

  it('skips image XObject streams (DCTDecode) — never scraped as text', async () => {
    const img = `4 0 obj<</Subtype/Image/Filter/DCTDecode/Length 20>>stream\n(JPEGbytes)(garbage)\nendstream endobj`;
    const content = `2 0 obj<</Length 62>>stream\nBT (Jordan Rivera Senior Engineer Globex Austin) Tj ET\nendstream endobj`;
    const t = await extractPdfText(enc(`%PDF-1.4\n${img}\n${content}\n%%EOF`));
    expect(t).toContain('Jordan Rivera');
    expect(t).not.toContain('JPEG');
  });

  it('skips embedded font-program streams (their bytes must never leak as text)', async () => {
    // A FontFile2 stream full of "(...)" garbage next to a real content stream: only the content wins.
    const font = `4 0 obj<</Length1 99/Subtype/CIDFontType0C/Length 30>>stream\n(GARBAGEfontDATA)(morejunk)\nendstream endobj`;
    const content = `2 0 obj<</Length 62>>stream\nBT (Jordan Rivera Senior Engineer Globex Austin) Tj ET\nendstream endobj`;
    const t = await extractPdfText(enc(`%PDF-1.4\n${font}\n${content}\n%%EOF`));
    expect(t).toContain('Jordan Rivera');
    expect(t).not.toContain('GARBAGE');
  });
});
