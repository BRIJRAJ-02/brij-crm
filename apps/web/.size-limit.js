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
// The hosted form (spec 0023) draws with the library's own controls since 19 October 2026, so it loads React
// and React Aria: 8.4 kB of JavaScript and 4.4 kB of CSS before, 197.8 kB and 12.2 kB after (gzipped, measured
// on the built page). Its own budget leaves about 10% of room. The phone library loads later, on demand.
const form = firstLoad(manifest, 'form.html');
// The booking pages (spec 0025) draw with the library too since 20 October 2026, through @crm/ui/public-booking:
// 211.5 kB of JavaScript and 15.8 kB of CSS (gzipped, as size-limit measures it), with about 10% of room.
// On 20 October 2026 landing2 measured 230.64 kB, past the budget. Booking milestone 2 loads the guest page, the
// visitor bar (its Not you menu) and the details step beside the first paint rather than in it: 214.5 kB.
const book = firstLoad(manifest, 'book.html');
const inDist = (files) => files.map((file) => path.join(DIST, file));

// React's development build carries this message; production never does.
const DEVELOPMENT_REACT = 'Download the React DevTools';
if (inDist(js).some((file) => readFileSync(file, 'utf8').includes(DEVELOPMENT_REACT))) {
  throw new Error("dist holds React's development build. Build with NODE_ENV unset or production, then measure again.");
}

export default [
  { name: 'First load JavaScript (gzipped)', path: inDist(js), limit: '250 kB', gzip: true, running: false },
  { name: 'First load CSS (gzipped)', path: inDist(css), limit: '40 kB', gzip: true, running: false },
  { name: 'Hosted form JavaScript (gzipped)', path: inDist(form.js), limit: '220 kB', gzip: true, running: false },
  { name: 'Hosted form CSS (gzipped)', path: inDist(form.css), limit: '16 kB', gzip: true, running: false },
  { name: 'Booking page JavaScript (gzipped)', path: inDist(book.js), limit: '230 kB', gzip: true, running: false },
  { name: 'Booking page CSS (gzipped)', path: inDist(book.css), limit: '18 kB', gzip: true, running: false },
];
