// The library's own Vite config, shared by Storybook (which loads it), the
// Vitest projects (vitest.config.ts extends it) and the artifact build.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { uiVite } from './src/vite.ts';

export default defineConfig({
  plugins: [react(), uiVite()],
});
