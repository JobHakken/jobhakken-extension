/**
 * Minimal, dependency-free PDF → text extractor (the inverse of pdf.ts's builder). Enough to pull the
 * text out of a normal text-based résumé PDF so the AI résumé-input can parse it — no pdfjs, no worker,
 * no CSP change. It inflates FlateDecode streams with the platform `DecompressionStream` and scrapes
 * the text-showing operators. It does NOT do OCR: a scanned/image-only PDF yields little/no text, and
 * the caller should fall back to "paste your résumé text instead".
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

/** Pull the visible text out of a decoded content stream: literal (…) strings + <hex> strings. */
function scrapeContentText(s: string): string {
  const out: string[] = [];
  // literal strings — escape-aware, non-nested (covers the vast majority of résumé PDFs)
  const lit = /\((?:\\.|[^\\()])*\)/g;
  let m: RegExpExecArray | null;
  while ((m = lit.exec(s))) out.push(unescapePdfString(m[0].slice(1, -1)));
  // hex strings <...> (some producers emit these)
  const hex = /<([0-9A-Fa-f\s]+)>/g;
  while ((m = hex.exec(s))) {
    const h = m[1].replace(/\s+/g, '');
    if (h.length >= 2 && h.length % 2 === 0) {
      let t = '';
      for (let i = 0; i < h.length; i += 2) t += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
      if (/[ -~]/.test(t)) out.push(t);
    }
  }
  return out.join(' ');
}

/** Extract text from a PDF's bytes. Returns '' if nothing meaningful could be read. */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const bin = latin1(data);
  const parts: string[] = [];
  let i = 0;
  while (true) {
    const sIdx = bin.indexOf('stream', i);
    if (sIdx < 0) break;
    const eIdx = bin.indexOf('endstream', sIdx);
    if (eIdx < 0) break;
    let start = sIdx + 'stream'.length;
    if (bin[start] === '\r') start++;
    if (bin[start] === '\n') start++;
    const dictStart = bin.lastIndexOf('<<', sIdx);
    const dict = dictStart >= 0 ? bin.slice(dictStart, sIdx) : '';
    // Prefer the exact /Length — DecompressionStream is strict and rejects trailing bytes. When it's
    // a direct integer, use it; otherwise fall back to endstream minus the single spec EOL before it.
    const lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let end = eIdx;
    if (lenM && start + Number(lenM[1]) <= eIdx) {
      end = start + Number(lenM[1]);
    } else {
      if (bin[end - 1] === '\n') end--;
      if (bin[end - 1] === '\r') end--;
    }
    const raw = data.subarray(start, end);
    let text = '';
    if (/\/FlateDecode/.test(dict)) {
      try {
        text = latin1(await inflate(raw));
      } catch {
        text = '';
      }
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFax|Image)/.test(dict)) {
      text = latin1(raw); // uncompressed content stream
    }
    if (text) parts.push(scrapeContentText(text));
    i = eIdx + 'endstream'.length;
  }
  return parts
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
