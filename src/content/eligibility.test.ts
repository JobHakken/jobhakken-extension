/**
 * @jest-environment jsdom
 *
 * Content-script eligibility matching (the "won't sponsor" mark). These exercise the REAL
 * DOM path — jdContainer() → classifyEligibility() → anchorFor() → the injected pill — against
 * a fixture that mirrors LinkedIn's real structure: obfuscated CSS classes plus the stable
 * `JobDetails_AboutTheJob_<id>` container id. We read via textContent (a collapsed "…show more"
 * clause is still classified), so the fixtures set textContent, never innerText.
 *
 * A hand-built jsdom fixture (not a captured HTML asset) is used deliberately: it lets each
 * case isolate one classifier verdict + one anchor surface, and it pins the load-bearing
 * selectors (the real id prefix, `data-occludable-job-id` tiles) that the extractor depends on.
 * Job content is anonymous/example data.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { applyEligibilityFilter, getEligibilityVerdict } from './eligibility';

const FILLER =
  'We are a growing team building delightful products for customers around the world, and we value curiosity, ownership, and a bias for action.';

/** A LinkedIn-style detail pane: obfuscated classes + the real JobDetails_AboutTheJob id, plus
 *  a detail-pane company link (where the pill anchors). `jobId` feeds the container id. */
function detailPane(jobId: string, aboutText: string): void {
  document.body.innerHTML = `
    <div class="_1x2y3z jobs-details__main-content">
      <a class="ember-view _co_9f8e7d" href="https://www.linkedin.com/company/example-co/">Example Co</a>
      <div id="JobDetails_AboutTheJob_${jobId}" class="_ab12cd _desc34ef">
        <span class="_show-more-less">${aboutText} ${FILLER}</span>
      </div>
    </div>`;
}

describe('applyEligibilityFilter (content-script "won\'t sponsor" matching)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    applyEligibilityFilter(false, false); // reset module verdict state between cases
  });

  it('flags a role that requires U.S. citizenship and marks the anchor', () => {
    detailPane('3456789012', 'Applicants must be a U.S. citizen to be considered for this position.');
    applyEligibilityFilter(true, false);

    const verdict = getEligibilityVerdict();
    expect(verdict?.blocked).toBe(true);
    expect(verdict?.reasons.map((r) => r.category)).toContain('citizenship');
    // a small red pill is injected next to the detail-pane company link
    const pill = document.querySelector('.f2a-elig-mark');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toMatch(/No sponsorship/i);
  });

  it('flags an explicit "unable to provide sponsorship" role', () => {
    detailPane('4456789012', 'We are unable to provide visa sponsorship for this role now or in the future.');
    applyEligibilityFilter(true, false);

    const verdict = getEligibilityVerdict();
    expect(verdict?.blocked).toBe(true);
    expect(verdict?.reasons.map((r) => r.category)).toContain('sponsorship');
  });

  it('does NOT flag when sponsorship is explicitly offered (negation guard)', () => {
    detailPane('5456789012', 'Visa sponsorship is available for this position and we will sponsor qualified candidates.');
    applyEligibilityFilter(true, false);

    expect(getEligibilityVerdict()?.blocked).toBe(false);
    expect(document.querySelector('.f2a-elig-mark')).toBeNull();
  });

  it('does NOT flag a neutral job description', () => {
    detailPane('6456789012', 'We are looking for a frontend engineer with React experience to build user interfaces.');
    applyEligibilityFilter(true, false);

    expect(getEligibilityVerdict()?.blocked).toBe(false);
    expect(document.querySelector('.f2a-elig-mark')).toBeNull();
  });

  it('extracts the job id from the JobDetails_AboutTheJob container and HIDES the matching tile', () => {
    const jobId = '7456789012';
    // detail pane (blocked) + a search-list tile keyed by data-occludable-job-id; the company
    // link lives INSIDE the tile so anchorFor falls through to the tile (hide) surface.
    document.body.innerHTML = `
      <div class="jobs-details__main-content">
        <div id="JobDetails_AboutTheJob_${jobId}" class="_desc">
          <span>Applicants must be a U.S. citizen. ${FILLER}</span>
        </div>
      </div>
      <ul class="scaffold-layout__list-container">
        <li data-occludable-job-id="${jobId}" class="_tile00">
          <a href="https://www.linkedin.com/jobs/view/${jobId}" class="_title">Software Engineer</a>
          <a href="https://www.linkedin.com/company/example-co/" class="_co">Example Co</a>
        </li>
      </ul>`;

    applyEligibilityFilter(true, true); // hide mode

    const tile = document.querySelector<HTMLElement>(`li[data-occludable-job-id="${jobId}"]`);
    expect(tile?.style.display).toBe('none');
    expect(tile?.getAttribute('data-f2a-elig')).toBe('hidden');
  });
});
