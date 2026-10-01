// The library's own Vite config, shared by Storybook (which loads it), the
// Vitest projects (vitest.config.ts extends it) and the artifact build.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { uiVite } from './src/vite.ts';

export default defineConfig({
  plugins: [react(), uiVite()],
  // Bundled up front, so the dev server never finds one halfway through a
  // test run and reloads the page under it.
  optimizeDeps: {
    include: [
      'react-aria-components',
      'react-aria',
      '@internationalized/date',
      'lucide-react',
      'zod',
      'libphonenumber-js/max',
      'react-dom/client',
    ],
  },
});
