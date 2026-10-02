import { defineConfig } from '@playwright/test';

// Takes the screenshots for the user manual (docs/manual). Run
// `npm run manual`: it builds the app, takes the pictures, and prints
// docs/manual/Nyahmation-User-Manual.pdf.
export default defineConfig({
  testDir: '.',
  testMatch: 'shots.spec.ts',
  timeout: 120_000,
  workers: 1,
  outputDir: '../../test-results/manual',
});
