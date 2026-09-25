import { defineConfig } from '@playwright/test';

// End-to-end tests launch the built Electron app (run `npm run build` first).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  outputDir: './test-results',
});
