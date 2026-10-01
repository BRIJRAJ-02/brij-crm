// Hovers an element in a story until React Aria reports it hovered. Under CI
// load the story's styles can land just after the pointer does; the element
// then moves out from under it and Chromium ends the hover. Hovering again
// once the layout has settled makes the hovered look deterministic. Stories only.
import { expect, waitFor } from 'storybook/test';

/** The part of a story's `userEvent` this needs. */
interface Pointer {
  hover(element: Element): Promise<void>;
}

/** Moves the pointer onto `element`, again if needed, until it carries `data-hovered`. */
export async function hoverUntilHovered(userEvent: Pointer, element: Element): Promise<void> {
  await waitFor(async () => {
    await userEvent.hover(element);
    await expect(element).toHaveAttribute('data-hovered', 'true');
  });
}
