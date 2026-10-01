import { uiVite } from '@crm/ui/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_DEV_ORIGIN = 'http://localhost:3000';

export default defineConfig({
  // One `.env` at the repo root for local work.
  envDir: '../..',
  plugins: [
    // Must come before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true, addExtensions: true }),
    react(),
    // CSS module classes as ws-<component>-<local>, as in Storybook and the artifact.
    uiVite(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    // Same origin locally too: the browser only ever talks to :5173.
    proxy: { '/api': { target: API_DEV_ORIGIN } },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // dist/.vite/manifest.json: the first load budget reads the index route's static graph from it.
    manifest: true,
  },
});
