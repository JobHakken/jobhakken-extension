/**
 * Minimal, dependency-free PDF → text extractor (the inverse of pdf.ts's builder). Enough to pull the
 * text out of a normal text-based résumé PDF so the AI résumé-input can parse it — no pdfjs, no worker,
 * no CSP change. It inflates FlateDecode streams with the platform `DecompressionStream`, applies the
 * fonts' `/ToUnicode` CMaps (so subset/CID fonts decode to real text instead of glyph codes), and
 * scrapes ONLY content streams (never font/image binary). If the result doesn't look like real text
 * (image-only/scanned PDF, or an encoding we can't map) it returns '' so the caller can fall back to
 * "paste your résumé text instead" — better an empty box than a box full of garbage.
 */

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return s;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // FlateDecode is zlib (RFC 1950) → DecompressionStream('deflate').
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

/** Un-escape a PDF literal string body (between the parens): \n \r \t \( \) \\ and \ddd octal. */
function unescapePdfString(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, esc: string) => {
    switch (esc) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case '(':
        return '(';
      case ')':
        return ')';
      case '\\':
        return '\\';
      default:
        return String.fromCharCode(parseInt(esc, 8) & 0xff); // octal
    }
  });
}

/** A UTF-16BE hex run (the `/ToUnicode` destination) → a JS string. */
function hexToUtf16(hex: string): string {
  let s = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  if (hex.length % 4 === 2) s += String.fromCharCode(parseInt(hex.slice(-2), 16)); // stray single byte
  return s;
}

type UniMap = { map: Map<number, string>; width: number };

/**
 * Parse a `/ToUnicode` CMap body (bfchar + bfrange) into `uni`. Returns whether the source codes are
 * 2-byte (CID) — most modern subset fonts.
 */
function parseCMap(text: string, uni: Map<number, string>): number {
  let width = 1;
  for (const blk of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blk))) {
      if (m[1].length >= 4) width = 2;
      uni.set(parseInt(m[1], 16), hexToUtf16(m[2]));
    }
  }
  for (const blk of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    // <lo> <hi> [<d0> <d1> …]  — explicit per-code destinations
    const arr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = arr.exec(blk))) {
      if (m[1].length >= 4) width = 2;
      const lo = parseInt(m[1], 16);
      (m[3].match(/<([0-9A-Fa-f]+)>/g) ?? []).forEach((d, i) => uni.set(lo + i, hexToUtf16(d.slice(1, -1))));
    }
    // <lo> <hi> <dst>  — contiguous range starting at dst (increment the last code unit)
    const rng = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    while ((m = rng.exec(blk))) {
      if (m[1].length >= 4) width = 2;
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const base = hexToUtf16(m[3]);
      for (let c = lo; c <= hi && c - lo < 0x10000; c++) {
        const u = base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo));
        uni.set(c, u);
      }
    }
  }
  return width;
}

/** Decode one show-string's bytes through the ToUnicode map (or latin1 when there's no map). */
function decodeBytes(bytes: number[], uni: UniMap): string {
  if (uni.map.size === 0) return String.fromCharCode(...bytes); // ASCII/WinAnsi PDF — bytes are the text
  if (uni.width === 2) {
    let out = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) out += uni.map.get((bytes[i] << 8) | bytes[i + 1]) ?? '';
    return out;
  }
  let out = '';
  for (const b of bytes) out += uni.map.get(b) ?? String.fromCharCode(b);
  return out;
}

function litBytes(token: string): number[] {
  return [...unescapePdfString(token.slice(1, -1))].map((c) => c.charCodeAt(0) & 0xff);
}
function hexBytes(token: string): number[] {
  const h = token.replace(/[<>\s]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 1 < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
  return bytes;
}

/** Decode a TJ array `[(a)-250(b)…]`: join strings; a large negative kern is a word space. */
function decodeTJ(arr: string, uni: UniMap): string {
  let out = '';
  const tok = /(\((?:\\.|[^\\()])*\))|(<[0-9A-Fa-f\s]+>)|(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = tok.exec(arr))) {
    if (m[1]) out += decodeBytes(litBytes(m[1]), uni);
    else if (m[2]) out += decodeBytes(hexBytes(m[2]), uni);
    else if (m[3] && Number(m[3]) <= -120) out += ' '; // word-gap kern
  }
  return out;
}

/**
 * Scrape a CONTENT stream honoring layout. Show operands are concatenated (word spaces come from real
 * space glyphs + TJ kerns); a line break is emitted ONLY on a VERTICAL text-position change — so a PDF
 * that positions every glyph with its own `Tm` (same line, changing X) doesn't get split per glyph,
 * while genuine new lines (changing Y) are preserved.
 */
function scrapeContentText(s: string, uni: UniMap): string {
  const parts: string[] = [];
  let lastY: number | null = null;
  const op =
    /(\[(?:[^[\]]|\\.)*\])\s*TJ|(\((?:\\.|[^\\()])*\))\s*(?:Tj|')|(<[0-9A-Fa-f\s]+>)\s*Tj|((?:-?\d*\.?\d+\s+)+)(Td|TD|Tm)|(T\*)/g;
  let m: RegExpExecArray | null;
  while ((m = op.exec(s))) {
    if (m[1]) parts.push(decodeTJ(m[1], uni));
    else if (m[2]) parts.push(decodeBytes(litBytes(m[2]), uni));
    else if (m[3]) parts.push(decodeBytes(hexBytes(m[3]), uni));
    else if (m[5]) {
      const nums = (m[4].match(/-?\d*\.?\d+/g) ?? []).map(Number);
      if (m[5] === 'Tm') {
        const y = nums[5] ?? nums[nums.length - 1]; // f in [a b c d e f]
        if (lastY !== null && Math.abs(y - lastY) > 1.5) parts.push('\n');
        lastY = y;
      } else if (Math.abs(nums[1] ?? 0) > 1.5) {
        parts.push('\n'); // x y Td/TD with a vertical move
      }
    } else if (m[6]) parts.push('\n'); // T*
  }
  return parts.join('');
}

/** Word-ish score — used to pick the better of the ASCII vs ToUnicode decodings of a stream. */
function textScore(t: string): number {
  return (t.match(/[A-Za-z]{2,}/g) ?? []).length;
}

/** True when the extracted string reads like real prose (not glyph-code / binary garbage). */
function looksLikeText(t: string): boolean {
  if (t.length < 12) return false;
  const words = (t.match(/[A-Za-z]{2,}/g) ?? []).length;
  const ordinary = (t.match(/[A-Za-z0-9 \n.,@\-/]/g) ?? []).length;
  // Need several real words AND a majority of ordinary résumé characters — glyph-code/binary garbage
  // fails the ratio; a real résumé (hundreds of words) sails through.
  return words >= 4 && ordinary / t.length >= 0.6;
}

/** Iterate `stream…endstream` blocks, invoking `onStream(dict, bytes)` for each. */
async function eachStream(
  data: Uint8Array,
  bin: string,
  onStream: (dict: string, bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  let i = 0;
  for (;;) {
    const sIdx = bin.indexOf('stream', i);
    if (sIdx < 0) break;
    const eIdx = bin.indexOf('endstream', sIdx);
    if (eIdx < 0) break;
    let start = sIdx + 'stream'.length;
    if (bin[start] === '\r') start++;
    if (bin[start] === '\n') start++;
    const dictStart = bin.lastIndexOf('<<', sIdx);
    const dict = dictStart >= 0 ? bin.slice(dictStart, sIdx) : '';
    // Prefer the exact /Length — DecompressionStream is strict and rejects trailing bytes. When it's a
    // direct integer use it; otherwise fall back to endstream minus the single spec EOL before it.
    const lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let end = eIdx;
    if (lenM && start + Number(lenM[1]) <= eIdx) {
      end = start + Number(lenM[1]);
    } else {
      if (bin[end - 1] === '\n') end--;
      if (bin[end - 1] === '\r') end--;
    }
    await onStream(dict, data.subarray(start, end));
    i = eIdx + 'endstream'.length;
  }
}

/** Read a stream's bytes as text: inflate FlateDecode, pass through uncompressed, skip image data. */
async function streamText(dict: string, raw: Uint8Array): Promise<string> {
  if (/\/FlateDecode/.test(dict)) {
    try {
      return latin1(await inflate(raw));
    } catch {
      return '';
    }
  }
  if (/\/(DCTDecode|JPXDecode|CCITTFax|JBIG2)/.test(dict)) return ''; // image data — never text
  return latin1(raw); // uncompressed
}

/** Extract text from a PDF's bytes. Returns '' when nothing meaningful (image-only / unmappable). */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const bin = latin1(data);
  const uni: UniMap = { map: new Map(), width: 1 };
  const contentTexts: string[] = [];

  // Pass 1: build the ToUnicode map from CMap streams; stash content streams (defer scraping until the
  // map is complete). Skip embedded font programs + images entirely — scraping THOSE is what produced
  // the binary garbage users saw in the paste box.
  await eachStream(data, bin, async (dict, raw) => {
    if (/\/(FontFile\d?|Image)\b/.test(dict) || /\/Subtype\s*\/(Type1C|CIDFontType0C|TrueType|Image)/.test(dict)) {
      return; // font program or image object — no page text here
    }
    const text = await streamText(dict, raw);
    if (!text) return;
    if (/beginbfchar|beginbfrange/.test(text)) {
      const w = parseCMap(text, uni.map);
      if (w === 2) uni.width = 2; // any CID CMap ⇒ decode show-strings as 2-byte
      return;
    }
    if (/\bTj\b|\bTJ\b/.test(text)) contentTexts.push(text); // a real content stream
  });

  // Pass 2: scrape each content stream BOTH ways (raw ASCII + ToUnicode-mapped) and keep whichever
  // reads more like text. A PDF often mixes an ASCII font (extract raw) with a CID font (needs the
  // map); per-stream pick-best handles that without resolving each /Font resource.
  const ascii: UniMap = { map: new Map(), width: 1 };
  const result = contentTexts
    .map((t) => {
      const a = scrapeContentText(t, ascii);
      if (uni.map.size === 0) return a;
      const b = scrapeContentText(t, uni);
      return textScore(b) >= textScore(a) ? b : a;
    })
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/ *\n */g, '\n')
    .trim();

  return looksLikeText(result) ? result : '';
}
