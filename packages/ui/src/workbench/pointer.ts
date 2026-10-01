// Hovers an element in a story until React Aria reports it hovered. Under CI
// load the story's styles can land just after the pointer does; the element
// then moves out from under it and Chromium ends the hover. Hovering again
// once the layout has settled makes the hovered look deterministic. Stories only.
//
// Both helpers also set React Aria's interaction modality to pointer first.
// Tooltips open on hover only after pointer input, and moving a pointer isn't
// input (a press is), so a story run after a keyboard story would otherwise
// hover without a tooltip. Files share one page, so the order decides it.
import { setInteractionModality } from 'react-aria';
import { expect, waitFor } from 'storybook/test';

/** The part of a story's `userEvent` this needs. */
interface Pointer {
  hover(element: Element): Promise<void>;
  unhover(element: Element): Promise<void>;
}

/** Moves the pointer off and onto `element`, again if needed, until it carries `data-hovered`. */
export async function hoverUntilHovered(userEvent: Pointer, element: Element): Promise<void> {
  setInteractionModality('pointer');
  await waitFor(async () => {
    // Off, then on: a pointer already resting there sends no new enter event.
    await userEvent.unhover(element);
    await userEvent.hover(element);
    await expect(element).toHaveAttribute('data-hovered', 'true');
  });
}

/** Waits for fonts and a settled frame, so a font swap can't move the element out from under the pointer once it is there. */
async function layoutSettled(): Promise<void> {
  await document.fonts.ready;
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

/** Moves the pointer off and then onto `element`, so it gets a fresh enter even if an earlier story left the pointer on that spot. */
export async function hoverFresh(userEvent: Pointer, element: Element): Promise<void> {
  await layoutSettled();
  setInteractionModality('pointer');
  await userEvent.unhover(element);
  await userEvent.hover(element);
}
