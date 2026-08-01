/**
 * Mechanical never-submit interlock for live/capture runs (plan §7 / rethink #4).
 *
 * Our tooling only autofills — it never clicks a submit button — but "we don't call submit" is a
 * convention, not a control. This makes it a MECHANICAL guarantee so a stray click/script can't
 * ever POST an application to a real employer:
 *   1. Abort any NON-GET navigation request (a real form submission is a POST/PUT navigation).
 *      XHR/fetch (analytics, field validation, lazy dropdowns) still flow, so the page works.
 *   2. Neutralise native <form> submit events before the page's own scripts run.
 *
 * Apply to any context that loads a real site (live-smoke, capture). Never needed on local fixtures.
 */
import type { BrowserContext } from '@playwright/test';

export async function installNoSubmit(context: BrowserContext): Promise<void> {
  await context.route('**', (route) => {
    const req = route.request();
    if (req.isNavigationRequest() && req.method() !== 'GET') return route.abort();
    return route.continue();
  });
  await context.addInitScript(() => {
    document.addEventListener('submit', (e) => e.preventDefault(), true);
  });
}
