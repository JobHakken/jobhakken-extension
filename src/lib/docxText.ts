/**
 * Minimal, dependency-free Word .docx → text extractor (companion to pdfText.ts). A .docx is a ZIP
 * whose `word/document.xml` holds the body; we read the ZIP central directory, inflate that entry
 * (raw deflate), and strip the WordprocessingML to text. No JSZip, no worker. Handles the normal
 * text-based docx; the legacy binary .doc format is NOT supported (caller falls back to "paste").
 */

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return s;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw'); // ZIP entries are raw DEFLATE (no zlib header)
  const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

/** Convert the body's WordprocessingML to plain text: paragraphs → newlines, tags stripped, entities decoded. */
export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function findEocd(b: Uint8Array): number {
  for (let i = b.length - 22; i >= 0; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i;
  }
  return -1;
}

/** Extract text from a .docx byte array. Returns '' if it isn't a readable docx. */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => d.getUint16(o, true);
  const u32 = (o: number) => d.getUint32(o, true);
  const eocd = findEocd(bytes);
  if (eocd < 0) return '';
  const count = u16(eocd + 10);
  let off = u32(eocd + 16); // central directory offset
  let target: { method: number; compSize: number; localOff: number } | null = null;
  for (let i = 0; i < count && off + 46 <= bytes.length; i++) {
    if (u32(off) !== 0x02014b50) break; // central-dir header signature
    const method = u16(off + 10);
    const compSize = u32(off + 20);
    const fnLen = u16(off + 28);
    const extraLen = u16(off + 30);
    const commentLen = u16(off + 32);
    const localOff = u32(off + 42);
    const name = latin1(bytes.subarray(off + 46, off + 46 + fnLen));
    if (name === 'word/document.xml') {
      target = { method, compSize, localOff };
      break;
    }
    off += 46 + fnLen + extraLen + commentLen;
  }
  if (!target) return '';
  const lo = target.localOff;
  if (u32(lo) !== 0x04034b50) return ''; // local-file-header signature
  const dataStart = lo + 30 + u16(lo + 26) + u16(lo + 28); // + local filename + local extra
  const raw = bytes.subarray(dataStart, dataStart + target.compSize);
  let xml: string;
  try {
    const inflated = target.method === 8 ? await inflateRaw(raw) : raw; // 8 = deflate, 0 = stored
    xml = new TextDecoder('utf-8').decode(inflated); // document.xml is UTF-8 (latin1 would mangle — © etc.)
  } catch {
    return '';
  }
  return docxXmlToText(xml);
}
