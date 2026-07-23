/**
 * Minimal, dependency-free PDF builder for the browser. Turns plain text into a valid
 * one-page PDF (%PDF … %%EOF with a correct xref) the extension can attach to a file
 * input — used for the default cover letter and the test-mode dummy documents. Text is
 * ASCII-folded so byte offsets stay exact; long lines wrap. Not a typesetter — enough
 * for a document the user reviews before submitting.
 */
function asciiFold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
}
function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function wrap(lines: string[], max = 90): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= max) {
      out.push(line);
      continue;
    }
    let cur = '';
    for (const word of line.split(/\s+/)) {
      if ((cur + ' ' + word).trim().length > max) {
        out.push(cur);
        cur = word;
      } else {
        cur = cur ? `${cur} ${word}` : word;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export function textToPdf(title: string, rawLines: string[]): Uint8Array {
  const lines = wrap([title, '', ...rawLines].map(asciiFold));
  const content = `BT /F1 12 Tf 50 760 Td 16 TL ${lines.map((l) => `(${escapePdf(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  // content is ASCII-only → charCode == byte, so the computed offsets are byte-accurate
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

export function textToPdfFile(text: string, name: string, title?: string): File {
  const bytes = textToPdf(title ?? name.replace(/\.pdf$/i, ''), text.split('\n'));
  return new File([bytes as BlobPart], name, { type: 'application/pdf' });
}
