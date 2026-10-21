// When the document's web fonts finish loading. Inter is font-display: swap, so on a cold visit text can paint in
// the fallback face first and change size when Inter arrives. A virtualised list that measured each row once (React
// Aria's Virtualizer measures a row when it is built, never again) would keep the fallback's heights, and its rows
// would overlap. The lists that measure their rows (NoteList, the board's columns) add this to their collection's
// dependencies, so each row is built again, and measured again, once the fonts are in.
import { useEffect, useState } from 'react';

/** What the hook needs of the document's fonts: the standard FontFaceSet. */
export interface FontEvents {
  readonly status: string;
  readonly ready: Promise<unknown>;
  readonly addEventListener: (type: 'loadingdone', listener: () => void) => void;
  readonly removeEventListener: (type: 'loadingdone', listener: () => void) => void;
}

/**
 * Calls `onSettled` each time `fonts` finish loading a batch of faces (a web font swapping in for its fallback,
 * a code block's mono face arriving later), and once more when the faces loading now are all in. Answers a
 * function that stops listening.
 */
export function watchFontsSettled(fonts: FontEvents, onSettled: () => void): () => void {
  let isWatching = true;
  const settled = () => {
    if (isWatching) onSettled();
  };
  if (fonts.status === 'loading') {
    void fonts.ready.then(settled, () => undefined);
  }
  fonts.addEventListener('loadingdone', settled);
  return () => {
    isWatching = false;
    fonts.removeEventListener('loadingdone', settled);
  };
}

/**
 * A number that moves on each time the document's fonts finish loading: 0 at first, and it stays 0 when the fonts
 * were in before the component mounted. A list that measures its rows lists it among what its rows depend on.
 */
export function useFontsSettled(): number {
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return undefined;
    return watchFontsSettled(document.fonts, () => {
      setSettled((count) => count + 1);
    });
  }, []);
  return settled;
}
