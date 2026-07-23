import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests that run the REAL extension in a REAL Chromium against our committed
 * fixtures — the layer jsdom can't cover (DataTransfer file upload, live combobox
 * open→pick, actual content-script events). No login/CAPTCHA: everything is served
 * locally from e2e/fixtures via scripts/serve-fixtures.mjs.
 *
 * Prereqs: `npm run build` (dist) + `npx playwright install chromium`.
 * Run: `npm run test:e2e`.
 *
 * WATCH IT VISUALLY (see exactly what the extension did):
 *   npm run test:e2e:ui      → Playwright UI: time-travel through every step with DOM snapshots
 *   npm run test:e2e:headed  → a real visible Chromium window (PWHEAD=1 + slowMo)
 *   pnpm run test:e2e:report  → open the last HTML report (screenshots + traces per test)
 * Every run records a trace + a failure screenshot/video; open a trace with
 *   npx playwright show-trace test-results/<...>/trace.zip
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // Retry transient flakes (the heavy Greenhouse/Workday autofill captures — reCAPTCHA + many
  // live comboboxes — can exceed their poll window under load). A retried-then-passed test is
  // reported as "flaky" (visible, not hidden); a genuine failure fails every attempt and still
  // reddens the gate.
  retries: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8787',
    actionTimeout: 10_000,
    trace: 'on', // full DOM/action history for every run (viewable in the report)
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'F2A_FIXTURES_ONLY=1 node scripts/serve-fixtures.mjs',
      url: 'http://127.0.0.1:8787',
      reuseExistingServer: true,
      timeout: 20_000,
    },
    {
      // mock desktop bridge → lets E2E test the CONNECTED extension (incl. test-mode sync)
      command: 'node e2e/mock-bridge.mjs',
      url: 'http://127.0.0.1:41599/health', // dedicated test port — see e2e/mock-bridge.mjs
      reuseExistingServer: true,
      timeout: 20_000,
    },
  ],
});
