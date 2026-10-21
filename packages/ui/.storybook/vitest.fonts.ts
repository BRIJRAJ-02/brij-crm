// Runs before every story test (the `stories` and `visual` projects): the
// library's two faces load before the story renders. They are `font-display:
// swap`, so a story drawn before they arrived measured its text in the
// fallback face, and a list that measures each row once (NoteList's
// virtualised rows) kept the fallback's shorter heights after the swap: CI
// caught NoteList's rows overlapping in one run and not the next (21 October
// 2026). The app loads them with its first paint, long before such a list
// mounts. Loading an already loaded face resolves at once.
import { beforeEach } from 'vitest';

beforeEach(async () => {
  await Promise.all([document.fonts.load('16px Inter'), document.fonts.load('16px "JetBrains Mono"')]);
});
