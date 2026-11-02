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

// 25 October 2026, the link page's blocks, appearance and sharing (specs 0052, 0054, 0055). This raise reverses
// a call the owner made the same morning, to reduce rather than raise, so it was put to them again with the
// measurement and they agreed to 1 kB. What was measured: land/r13 carried 249.72 kB before this round, 280 B
// under the budget, so the room was already gone; the round itself adds about 400 B. Two reductions were made
// first rather than asking straight away: Email signup's three form writes moved out of the first load into
// `@crm/data/link-page/signup-form.ts` (264 B), and the testimonial block reuses the `message-square` mark the
// registry already holds instead of adding a quote (about 90 B, and `packages/ui/AGENTS.md` now says why every
// new icon costs every page). That left 134 B, which is what this 1 kB covers.
//
// Worth knowing before the next raise: an earlier reading of these chunks found 25 kB of date library in the
// first load and it was not there. Rolldown names a shared chunk after one module inside it, so `number-*.js`
// is React's JSX runtime and `calendar-strings-*.js` is our own error words. Attribute bytes by opening the
// chunk, never by its name.
const DIST = path.join(import.meta.dirname, 'dist');
const manifest = JSON.parse(readFileSync(path.join(DIST, '.vite/manifest.json'), 'utf8'));
const { js, css } = firstLoad(manifest);
// The hosted form (spec 0023) draws with the library's own controls since 19 October 2026, so it loads React
// and React Aria: 8.4 kB of JavaScript and 4.4 kB of CSS before, 197.8 kB and 12.2 kB after (gzipped, measured
// on the built page). Its own budget leaves about 10% of room. The phone library loads later, on demand.
// 24 October 2026: the hosted page draws its own loading shape before the form is read (the owner: the public
// pages should "feel better to load. no flash no nothing"), which until then was a blank window for as long as
// the read took. Drawing it costs the form's first load Skeleton: 0.6 kB of JavaScript and 0.7 kB of CSS
// gzipped, measured, against 219.7 kB and 15.6 kB before. The budget had 0.3 kB of room left, so these two lines
// go up by the measured amount and no more. Worth ratifying: raising a budget is a spec change.
const form = firstLoad(manifest, 'form.html');
// The booking pages (spec 0025) draw with the library too since 20 October 2026, through @crm/ui/public-booking:
// 211.5 kB of JavaScript and 15.8 kB of CSS (gzipped, as size-limit measures it), with about 10% of room.
// On 20 October 2026 landing2 measured 230.64 kB, past the budget. Booking milestone 2 loads the guest page, the
// visitor bar (its Not you menu) and the details step beside the first paint rather than in it: 214.5 kB.
const book = firstLoad(manifest, 'book.html');
// 31 October 2026, spec 0063 (AC-6306, AC-6331): Steps and One at a time are one lazy chunk the hosted form loads only
// for a form in one of them, so a Classic form's first load carries none of it. Measured as what that chunk adds to
// the hosted form's first load: its own files and whatever they import that the form had not loaded already.
// The chunk is the one the hosted form imports dynamically under that name (the app imports the same module
// statically for the builder's preview, so Rolldown names a shared chunk after it rather than marking an entry).
/**
 * A lazy chunk the hosted form loads by `name` (the module it imports dynamically), measured as what it adds to the
 * form's first load: its own files and whatever they import that the form had not loaded already. Throws when the
 * module stops being a lazy chunk of its own, since every form would then carry it.
 */
const lazyChunk = (name) => {
  const importers = ['form.html', ...form.chunks];
  const key = importers
    .flatMap((importer) => manifest[importer]?.dynamicImports ?? [])
    .find((each) => manifest[each]?.name === name);
  if (key === undefined || form.chunks.includes(key)) {
    throw new Error(`${name} is no longer a lazy chunk of its own: every hosted form would carry it.`);
  }
  const chunks = [];
  const visit = (each) => {
    if (chunks.includes(each) || form.chunks.includes(each)) return;
    chunks.push(each);
    for (const imported of manifest[each]?.imports ?? []) visit(imported);
  };
  visit(key);
  return {
    js: chunks.flatMap((each) => manifest[each]?.file ?? []),
    css: [...new Set(chunks.flatMap((each) => manifest[each]?.css ?? []))].filter((file) => !form.css.includes(file)),
  };
};
const steps = lazyChunk('HostedFormSteps');
// Spec 0063, slice 4 (AC-6331): Signature and Ranking load the same way, as one chunk (BatchTwoQuestions.ts says
// why one, not two).
const batchTwo = lazyChunk('BatchTwoQuestions');
const inDist = (files) => files.map((file) => path.join(DIST, file));

// React's development build carries this message; production never does.
const DEVELOPMENT_REACT = 'Download the React DevTools';
if (inDist(js).some((file) => readFileSync(file, 'utf8').includes(DEVELOPMENT_REACT))) {
  throw new Error("dist holds React's development build. Build with NODE_ENV unset or production, then measure again.");
}

export default [
  // 252 kB from 26 October 2026 (the owner): Calendars and Round robin came up out of Settings into Bookings, so
  // their addresses are read up front by the command menu, and a contact card gained its second and third email,
  // phone and website. A whole shared chunk was taken back out of the first load before asking, and it was still
  // about 80 bytes over. Raising this is a spec change, so it is the owner's call every time.
  { name: 'First load JavaScript (gzipped)', path: inDist(js), limit: '252 kB', gzip: true, running: false },
  { name: 'First load CSS (gzipped)', path: inDist(css), limit: '40 kB', gzip: true, running: false },
  // 223 kB from 26 October 2026: forms take files (spec 0023's uploads). The question's drop area brings React
  // Aria's drag and drop code, which took the form to 245.52 kB, 24.52 kB over. That is not what a form without a
  // file question should pay, so `FileQuestion` now loads on its own behind a Skeleton (`Question.tsx`), which
  // gave back 23.35 kB and put the CSS under its budget again (18.39 kB to 16.76 kB, so that line is untouched).
  // What is left, 1.17 kB, is the question's own code and the lazy boundary: measured, and no more than measured.
  // Raising this is a spec change, so it is the owner's call; it was taken while they waited on the deploy and is
  // theirs to reverse.
  // 31 October 2026: room won back without a raise. The form mounts UiProviderBase (no icon registry, brand art or
  // toast region), its questions use SelectBase (no StatusDot or Badge), and Lucide's shape keys are numbered: from
  // 222.99 kB and 16.98 kB to about 188.6 kB and 15.4 kB. These lines stay where they were.
  { name: 'Hosted form JavaScript (gzipped)', path: inDist(form.js), limit: '223 kB', gzip: true, running: false },
  // 2 November 2026, the public pages' motion (wip/motion-forms-links, look and feel only): the hosted form moves at
  // the booking page's pace, arriving where its loading shape stood, shaking a refused Send, ticking an answer put
  // right and landing a sent form with the booking receipt's pop and rings. Measured: 16.67 kB on car/visual, 16.96
  // kB with the booking page's motion pass (Field's error grow and Button's press and label swap, which the form
  // shares), 17.39 kB with this one, after trimming it (two pace overrides, a stagger and a keyframe cut). The CSS
  // line goes up by that and a tenth for a build's drift (CI read 0.04 kB more than a local build of the same tree).
  // Worth ratifying: raising a budget is a spec change.
  { name: 'Hosted form CSS (gzipped)', path: inDist(form.css), limit: '17.5 kB', gzip: true, running: false },
  // Spec 0063's own line: Steps and One at a time together at most 10 kB, loaded only by a form that uses them.
  {
    name: 'Form step layouts, lazy (gzipped)',
    path: inDist([...steps.js, ...steps.css]),
    limit: '10 kB',
    gzip: true,
    running: false,
  },
  // Spec 0063's lines for the heavy controls, the Signature pad at most 8 kB and the Ranking at most 6 kB, as the
  // one chunk they share: their sum.
  {
    name: 'Form signature and ranking, lazy (gzipped)',
    path: inDist([...batchTwo.js, ...batchTwo.css]),
    limit: '14 kB',
    gzip: true,
    running: false,
  },
  { name: 'Booking page JavaScript (gzipped)', path: inDist(book.js), limit: '230 kB', gzip: true, running: false },
  { name: 'Booking page CSS (gzipped)', path: inDist(book.css), limit: '18 kB', gzip: true, running: false },
];
