/**
 * @jest-environment jsdom
 *
 * Content-script H-1B sponsor badging. Exercises the REAL DOM extraction path —
 * detailCompany() → cleanCompany() → the service-worker lookup (mocked) → the injected green
 * badge / popup verdict. The company-name cleanup (stripping "· N followers" LinkedIn subtitle
 * noise) is private, so we assert it through the exact company strings sent to the worker.
 *
 * A hand-built jsdom fixture is used (not a captured asset) so each case pins one company
 * surface and one lookup result; the /company/ anchor mirrors LinkedIn's detail pane. All
 * company names are anonymous/example data.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { applyH1bBadges, getH1bVerdict } from './h1b';

type SendMessage = jest.Mock<(msg: unknown) => Promise<{ matches: Record<string, number> }>>;
let sendMessage: SendMessage;

/** Install a fake chrome whose SW reply maps the given company → approvals. */
function mockWorker(matches: Record<string, number>): void {
  sendMessage = jest.fn(async () => ({ matches })) as unknown as SendMessage;
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage } };
}

/** A LinkedIn-style detail pane with a single /company/ link (the reliable badge surface). */
function detailPane(companyText: string): void {
  document.body.innerHTML = `
    <div class="jobs-details__main-content">
      <a class="ember-view _co" href="https://www.linkedin.com/company/example-co/">${companyText}</a>
    </div>`;
}

describe('applyH1bBadges (content-script H-1B sponsor matching)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it("badges the opened job's company and records the popup verdict", async () => {
    mockWorker({ 'Acme Widgets': 1500 });
    detailPane('Acme Widgets');

    await applyH1bBadges(true);

    // the exact company sent to the SW proves detailCompany() extraction
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'f2a-h1b', companies: ['Acme Widgets'] }));
    const badge = document.querySelector('.f2a-h1b-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toMatch(/H-1B sponsor/);
    expect(getH1bVerdict()).toEqual({ company: 'Acme Widgets', approvals: 1500 });
  });

  it('strips "· N followers" subtitle noise before looking the company up', async () => {
    mockWorker({ 'Globex Corp': 42 });
    detailPane('Globex Corp · 12,345 followers');

    await applyH1bBadges(true);

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ companies: ['Globex Corp'] }));
    expect(getH1bVerdict()).toEqual({ company: 'Globex Corp', approvals: 42 });
  });

  it('adds no badge and no verdict when the company is not a known sponsor', async () => {
    mockWorker({}); // SW found nothing
    detailPane('Nowhere Startup');

    await applyH1bBadges(true);

    expect(document.querySelector('.f2a-h1b-badge')).toBeNull();
    expect(getH1bVerdict()).toBeNull();
  });

  it('clears the verdict and skips the worker when the feature is off', async () => {
    mockWorker({ 'Should Not Query': 999 });
    detailPane('Should Not Query');

    await applyH1bBadges(false);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(getH1bVerdict()).toBeNull();
  });
});
