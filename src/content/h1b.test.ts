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

/** jsdom's own default hostname is `localhost` — every test below needs it overridden to LinkedIn,
 *  since applyH1bBadges() now refuses to run anywhere else (see the gate this file's last test pins). */
function setLocation(hostname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname: '/', href: `https://${hostname}/` },
    writable: true,
    configurable: true,
  });
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
    setLocation('www.linkedin.com');
  });

  it("badges the opened job's company and records the popup verdict", async () => {
    mockWorker({ 'Acme Widgets': 1500 });
    detailPane('Acme Widgets');

    await applyH1bBadges(true);

    // the exact company sent to the SW proves detailCompany() extraction
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'f2a-h1b', companies: ['Acme Widgets'] }));
    const badge = document.querySelector('.f2a-h1b-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toMatch(/Sponsors visas/);
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

  it('never badges an ordinary, non-LinkedIn site — even one with its own "/company/" link', async () => {
    // The reported bug, reproduced exactly: detailCompany()'s selector — any a[href*="/company/"] —
    // is not LinkedIn-specific, and applyBadges() ran on every page (content_scripts.matches is
    // <all_urls>, no gate). An ordinary site's own "About the Company" nav link matched it just as
    // well as LinkedIn's detail pane does, and if that link's text happened to match a real sponsor —
    // exactly what this fixture sets up — the badge rendered on a page with nothing to do with jobs.
    mockWorker({ 'Acme Widgets': 1500 }); // a REAL sponsor match, proving the gate — not a missed lookup
    setLocation('www.acme-garden-tools.example');
    document.body.innerHTML = `
      <nav><a href="/company/about">Acme Widgets</a></nav>
      <p>Buy our garden tools.</p>`;

    await applyH1bBadges(true);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(document.querySelector('.f2a-h1b-badge')).toBeNull();
    expect(getH1bVerdict()).toBeNull();
  });

  it('still badges normally on LinkedIn itself (the gate does not regress the real feature)', async () => {
    mockWorker({ 'Acme Widgets': 1500 });
    setLocation('www.linkedin.com');
    detailPane('Acme Widgets');

    await applyH1bBadges(true);

    expect(document.querySelector('.f2a-h1b-badge')).not.toBeNull();
    expect(getH1bVerdict()).toEqual({ company: 'Acme Widgets', approvals: 1500 });
  });
});
