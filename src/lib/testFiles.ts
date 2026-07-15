/**
 * Bundled dummy documents for TEST MODE, so résumé/cover-letter upload can be exercised
 * on live pages without attaching anything real. Minimal valid PDFs (start with the
 * %PDF magic + .pdf name) — enough for ATS upload widgets to accept them. Never submitted.
 */
function pdf(title: string): string {
  const body = `BT /F1 18 Tf 20 150 Td (${title}) Tj 0 -24 Td /F1 12 Tf (Anonymous test document - do not submit) Tj ET`;
  return [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${body.length}>>stream`,
    body,
    'endstream endobj',
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n');
}

export function dummyResumeFile(): File {
  return new File([pdf('Jordan Rivera - Resume (TEST)')], 'jordan-rivera-resume.pdf', { type: 'application/pdf' });
}
export function dummyCoverLetterFile(): File {
  return new File([pdf('Jordan Rivera - Cover Letter (TEST)')], 'jordan-rivera-cover-letter.pdf', { type: 'application/pdf' });
}
