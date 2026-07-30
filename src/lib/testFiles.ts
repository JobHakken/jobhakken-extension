import { textToPdfFile } from './pdf.js';

/**
 * Bundled dummy documents for TEST MODE, so résumé/cover-letter upload can be exercised
 * on live pages without attaching anything real. Valid PDFs built in-browser; never
 * submitted.
 */
export function dummyResumeFile(): File {
  return textToPdfFile(
    [
      'Jordan Rivera — Senior Engineer',
      'jordan.rivera@example.com | (201) 555-0123',
      '',
      'TEST DATA — do not submit.',
    ].join('\n'),
    'jordan-rivera-resume.pdf',
    'Jordan Rivera - Resume (TEST)',
  );
}
export function dummyCoverLetterFile(): File {
  return textToPdfFile(
    [
      'Dear Hiring Manager,',
      '',
      'Anonymous placeholder cover letter for testing only.',
      '',
      'Sincerely,',
      'Jordan Rivera',
    ].join('\n'),
    'jordan-rivera-cover-letter.pdf',
    'Jordan Rivera - Cover Letter (TEST)',
  );
}
