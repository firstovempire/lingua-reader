// Тесты в браузере: npm test (или npx playwright test). Сайт поднимается на http://localhost:8765.
// Локально берётся установленный Google Chrome (PW_CHANNEL=chrome), в GitHub — Chromium от Playwright.
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.js/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8765',
    channel: process.env.PW_CHANNEL || undefined,
    serviceWorkers: 'block', // иначе запросы шли бы мимо поддельного сервера
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
  },
  webServer: { command: 'node tests/serve.js 8765', url: 'http://localhost:8765', reuseExistingServer: !process.env.CI },
});
