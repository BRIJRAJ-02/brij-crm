// `pnpm size`: the first load budget (spec 0003, AC-18), on the built app in
// dist/. It measures the entry chunk and its static imports from Vite's
// manifest, gzipped. Raising a budget is a spec change.
//
// Baseline when the budget was set (1 October 2026, milestone 1 of #4):
// 197.7 kB of JavaScript (170.9 kB before UiProvider) and 3.9 kB of CSS.
// Those were measured on React's development build: NODE_ENV=development in
// the root .env leaked into local builds. It refuses that build now. The
// production first load on 1 October 2026 (milestone 2, with the status
// screen) is 162.2 kB of JavaScript and 5.5 kB of CSS.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { firstLoad } from './first-load.ts';

const DIST = path.join(import.meta.dirname, 'dist');
const manifest = JSON.parse(readFileSync(path.join(DIST, '.vite/manifest.json'), 'utf8'));
const { js, css } = firstLoad(manifest);
const inDist = (files) => files.map((file) => path.join(DIST, file));

// React's development build carries this message; production never does.
const DEVELOPMENT_REACT = 'Download the React DevTools';
if (inDist(js).some((file) => readFileSync(file, 'utf8').includes(DEVELOPMENT_REACT))) {
  throw new Error("dist holds React's development build. Build with NODE_ENV unset or production, then measure again.");
}

export default [
  { name: 'First load JavaScript (gzipped)', path: inDist(js), limit: '250 kB', gzip: true, running: false },
  { name: 'First load CSS (gzipped)', path: inDist(css), limit: '40 kB', gzip: true, running: false },
];
