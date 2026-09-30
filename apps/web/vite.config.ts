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
  },
});
