import { defineConfig } from 'vitest/config';

// The templates, the layout and the token mapping: pure functions, no database or network.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
