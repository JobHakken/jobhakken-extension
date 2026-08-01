/**
 * Which résumé the extension asks the desktop bridge for when attaching a file to an application
 * (ADR 0012, #397).
 *
 * When we know the desktop-side `jobId` for the current page (captured from a prior `saveJob`), the
 * default upload passes it so the bridge serves the résumé LINKED to that job — the per-job pick —
 * falling back on the desktop side to the default main when the job isn't linked. So **autofill
 * defaults to the job's linked résumé**. Without a jobId (the standalone / not-yet-saved path) the
 * behaviour is unchanged: the bridge serves the single active résumé.
 *
 * The AI-tailored path (`tailoredResumeFile`) still passes the scraped page job so the desktop tailors
 * on the fly; that RPC is not job-linked.
 */
export type ResumeFileRpc = {
  method: 'resumeFile' | 'tailoredResumeFile';
  params: Record<string, unknown>;
};

export function resumeFileRpc(
  mode: 'default' | 'ats',
  ctx: { savedJobId: number | null; pageJob: () => Record<string, unknown> },
): ResumeFileRpc {
  if (mode === 'ats') return { method: 'tailoredResumeFile', params: ctx.pageJob() };
  return { method: 'resumeFile', params: ctx.savedJobId != null ? { jobId: ctx.savedJobId } : {} };
}
