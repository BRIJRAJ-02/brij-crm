// Focus after the control in use went away with its own change (an archived
// row, a Restore button that became Archive, a cancelled job's Cancel): the
// page's visible title, so focus never falls back to the document (spec 0012,
// AC-246), after the change has drawn. A settings page's title is its
// layout's heading (the TopBar's h1 is visually hidden under its trail);
// elsewhere, the page's h1.
import { focusPage } from './focus.ts';

/** Moves focus to the page's visible title on the next frame. */
export function focusTitle(): void {
  requestAnimationFrame(() => {
    const settingsTitle = document.querySelector<HTMLElement>('main [data-settings-title]');
    if (settingsTitle === null) focusPage(document, window.location.pathname);
    else settingsTitle.focus();
  });
}
