// Focus after the control in use went away with its own change (an archived
// row, a Restore button that became Archive): the page's title, so focus never
// falls back to the document (spec 0012, AC-246), after the change has drawn.
import { focusPage } from './focus.ts';

/** Moves focus to the page's title on the next frame. */
export function focusTitle(): void {
  requestAnimationFrame(() => {
    focusPage(document, window.location.pathname);
  });
}
