import { defineConfig, devices } from '@playwright/test';

// The end-to-end suite: Chromium driving the built web app, served by a real
// Bandmate per worker (see fixtures.ts). `npm test` builds the web app first.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry in CI, so a flaky test shows as flaky rather than failing the
  // run, while still recording its trace.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Builds the Bandmate binary each worker starts.
  globalSetup: './global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    // Wide enough for the Songs page's table rather than its phone list.
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    // CHROMIUM picks a Chromium of your own, e.g. /usr/bin/chromium, in place
    // of the one `npx playwright install chromium` downloads.
    launchOptions: process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  },
});
