import pkg from '@playwright/test';
const { defineConfig } = pkg;

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    headless: true,
    serviceWorkers: 'block',
  },
});
