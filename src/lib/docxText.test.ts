import { describe, expect, it } from '@jest/globals';

import { docxXmlToText, extractDocxText } from './docxText';

const enc = (s: string) => new TextEncoder().encode(s);

/** Build a minimal single-entry ZIP (STORED, no compression) — enough to exercise the ZIP walk. */
function makeStoredZip(name: string, content: string): Uint8Array {
  const fn = enc(name);
  const data = enc(content);
  const total = 30 + fn.length + data.length + (46 + fn.length) + 22;
  const b = new Uint8Array(total);
  const d = new DataView(b.buffer);
  let o = 0;
  const w16 = (v: number) => {
    d.setUint16(o, v, true);
    o += 2;
  };
  const w32 = (v: number) => {
    d.setUint32(o, v, true);
    o += 4;
  };
  // local file header
  w32(0x04034b50);
  w16(20);
  w16(0);
  w16(0); // method = stored
  w16(0);
  w16(0);
  w32(0); // crc
  w32(data.length);
  w32(data.length);
  w16(fn.length);
  w16(0);
  b.set(fn, o);
  o += fn.length;
  b.set(data, o);
  o += data.length;
  // central directory
  const cdOff = o;
  w32(0x02014b50);
  w16(20);
  w16(20);
  w16(0);
  w16(0); // method = stored
  w16(0);
  w16(0);
  w32(0); // crc
  w32(data.length);
  w32(data.length);
  w16(fn.length);
  w16(0);
  w16(0); // fn/extra/comment len
  w16(0);
  w16(0);
  w32(0); // disk/intattr/extattr
  w32(0); // local header offset
  b.set(fn, o);
  o += fn.length;
  const cdSize = o - cdOff;
  // EOCD
  w32(0x06054b50);
  w16(0);
  w16(0);
  w16(1);
  w16(1);
  w32(cdSize);
  w32(cdOff);
  w16(0);
  return b;
}

describe('docxXmlToText', () => {
  it('turns paragraphs into newlines, strips tags, decodes entities', () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Jordan Rivera</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Senior Engineer &amp; Lead</w:t></w:r></w:p></w:body></w:document>';
    const t = docxXmlToText(xml);
    expect(t).toContain('Jordan Rivera');
    expect(t).toContain('Senior Engineer & Lead');
    expect(t.split('\n').length).toBeGreaterThanOrEqual(2);
  });
});

describe('extractDocxText', () => {
  it('reads word/document.xml out of a docx zip (stored entry)', async () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Jordan Rivera — Globex Corp</w:t></w:r></w:p></w:body></w:document>';
    const zip = makeStoredZip('word/document.xml', xml);
    expect(await extractDocxText(zip)).toContain('Jordan Rivera — Globex Corp');
  });

  it('returns empty for something that is not a docx', async () => {
    expect(await extractDocxText(enc('not a zip at all'))).toBe('');
  });
});
