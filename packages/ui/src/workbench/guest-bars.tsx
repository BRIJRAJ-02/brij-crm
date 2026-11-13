// The guest pages' bar height in their popups (spec 0074, AC-7426), for stories only: a sheet to open on a page, and
// a length read inside any element, so a story can hold a popup's `size-topbar` to the page's own bars.
import type { ReactNode } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { Modal, ModalTrigger } from '../molecules/Modal/Modal.tsx';

/** Props for GuestSheetTrigger: the opener's words, the sheet's title and what it holds. */
export interface GuestSheetTriggerProps {
  readonly opener: string;
  readonly title: string;
  readonly children: ReactNode;
}

/** A Button that opens a sheet, placed on a guest page so the sheet opens in that page's popup host. */
export function GuestSheetTrigger({ opener, title, children }: GuestSheetTriggerProps) {
  return (
    <ModalTrigger>
      <Button>{opener}</Button>
      <Modal title={title} variant="sheet">
        {children}
      </Modal>
    </ModalTrigger>
  );
}

/** How tall `value` (a custom property expression, `var(--size-topbar)`) is inside `inside`, in pixels. */
export function lengthIn(inside: Element, value: string): number {
  const probe = document.createElement('div');
  probe.style.blockSize = value;
  probe.style.position = 'absolute';
  inside.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}
