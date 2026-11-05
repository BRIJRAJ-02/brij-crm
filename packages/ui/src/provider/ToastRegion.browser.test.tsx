// A toast raised while a drawer is open must never sit over the drawer's footer (Save and Cancel), at a laptop's
// width or a phone's (a Menu walk found a toast on Save, 4 November 2026). The story raises the toast from the
// drawer's own Save; this checks the two rectangles, and that the toast stays outside the modal's hiding, so it is
// still announced and reachable. With VITE_TOAST_SHOTS=1 it also saves each width as a picture for a person's eyes.
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import preview from '../../.storybook/preview.tsx';
import * as ModalStories from '../molecules/Modal/Modal.stories.tsx';

setProjectAnnotations(preview);

const { DrawerWithToast, SheetWithToast } = composeStories(ModalStories);

/** The widths people use most: a laptop and a phone. */
const WIDTHS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

afterEach(async () => {
  await page.viewport(414, 896);
});

describe('ToastRegion beside a drawer', () => {
  it.each(WIDTHS)('keeps the toast off the footer at $width wide', async ({ width, height }) => {
    await page.viewport(width, height);
    // The story's play opens the drawer, presses Save and checks the rectangles itself.
    await DrawerWithToast.run();
    const toast = document.querySelector('[data-toast-region] [role="alertdialog"]');
    const save = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.startsWith('Save'));
    const foot = save?.parentElement;
    if (!(toast instanceof HTMLElement) || foot === null || foot === undefined) throw new Error('nothing to measure');
    expect(overlaps(toast.getBoundingClientRect(), foot.getBoundingClientRect())).toBe(false);
    // Both stay on screen.
    expect(toast.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(foot.getBoundingClientRect().bottom).toBeLessThanOrEqual(height + 1);
    // Still announced and reachable: the modal hides the page behind it, never the toasts.
    expect(toast.closest('[aria-hidden="true"], [inert]')).toBeNull();
    if (import.meta.env.VITE_TOAST_SHOTS === '1') {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
      await page.screenshot({ path: `../../.vitest/toast-shots/toast-drawer-${String(width)}.png` });
    }
  });

  it("keeps the toast off a phone's bottom sheet buttons", async () => {
    await page.viewport(390, 844);
    // The story's play presses Save and fails if the toast lands on the footer.
    await SheetWithToast.run();
    const toast = document.querySelector('[data-toast-region] [role="alertdialog"]');
    const save = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.startsWith('Save'));
    const foot = save?.parentElement;
    if (!(toast instanceof HTMLElement) || foot === null || foot === undefined) throw new Error('nothing to measure');
    expect(overlaps(toast.getBoundingClientRect(), foot.getBoundingClientRect())).toBe(false);
  });
});
