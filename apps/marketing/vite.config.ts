import { layerOrder, preloadFonts, uiVite } from '@crm/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Two builds share this config (package.json `build`): the client build turns index.html into the page shell, its
// one script (src/client.tsx, which hydrates the page), the stylesheets, the fonts and the layer order file; the
// SSR build (`--ssr src/render.tsx`) bundles the page as a function. scripts/prerender.ts then writes the rendered
// page into the shell, so the page draws before any script runs.
export default defineConfig({
  plugins: [uiVite(), layerOrder(), preloadFonts(), react()],
  // The old site's two tag ids, still set under their Next.js names on the Vercel project (and kept sensitive, so
  // nobody can read them to copy): the build takes them by those names too (tags.ts). Public ids by nature, both.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'NEXT_PUBLIC_CLARITY_PROJECT_ID'],
  // The copyright year and the provider's clock, fixed once per build so the prerendered page and its hydration agree.
  define: { __BUILD_YEAR__: JSON.stringify(new Date().getFullYear()), __BUILD_TIME__: JSON.stringify(Date.now()) },
  // The SSR build runs in Node, which can't load the workspace packages' TypeScript and CSS, so it bundles them all.
  ssr: { noExternal: true },
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
});
