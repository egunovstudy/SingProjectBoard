import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1, timeout: 30000,
  expect: {timeout: 10000}, reporter: [['list'], ['html', {open: 'never'}]],
  use: {
    baseURL: 'http://127.0.0.1:18080', viewport: {width: 1440, height: 960},
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined},
  },
  webServer: {command: '../scripts/run-e2e.sh', url: 'http://127.0.0.1:18080/api/health', timeout: 90000, reuseExistingServer: false},
});
