import { describe, expect, it } from '@jest/globals';

import { resumeFileRpc } from './jobResumeParams';

// ADR 0012 / #397 — autofill defaults to the résumé LINKED to the current job.
describe('resumeFileRpc', () => {
  const pageJob = () => ({ title: 'Backend Engineer', company: 'Example Co', description: 'Go, Postgres' });

  it('default upload passes the saved jobId so the bridge serves the linked résumé', () => {
    expect(resumeFileRpc('default', { savedJobId: 42, pageJob })).toEqual({
      method: 'resumeFile',
      params: { jobId: 42 },
    });
  });

  it('default upload omits jobId when the job was not saved (standalone path unchanged)', () => {
    expect(resumeFileRpc('default', { savedJobId: null, pageJob })).toEqual({
      method: 'resumeFile',
      params: {},
    });
  });

  it('ats mode tailors from the scraped page job (not job-linked)', () => {
    expect(resumeFileRpc('ats', { savedJobId: 42, pageJob })).toEqual({
      method: 'tailoredResumeFile',
      params: { title: 'Backend Engineer', company: 'Example Co', description: 'Go, Postgres' },
    });
  });
});
