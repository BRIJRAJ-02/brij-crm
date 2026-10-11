import { defineConfig } from 'vitest/config';

// The harness's pure parts (spec 0011, AC-212): the scheduler, the mix, the
// user model against a fake API, percentiles, verdicts and the report. They
// need no database; the seed's and the API's suites cover what does.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
