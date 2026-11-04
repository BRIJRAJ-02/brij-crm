// Brief
// Purpose: lets Captures › Links' list draw inside Bookings › Pages: its search in Bookings' strip, its empty state's New as Bookings' New booking page.
// Main task: hand the Links screen the two things the Captures layout normally gives it, from the Bookings layout.
// Leaves out: the list itself (LinksScreen) and the dialog (the Bookings layout holds it).
import type { ReactNode } from 'react';
import { CapturesCreateContext } from '../captures/create.tsx';
import { CapturesToolbarSlot } from '../captures/toolbarSlot.ts';
import { strings } from '../booking/strings.ts';
import { useBookingsNewPage, useBookingsToolbarSlot } from './toolbarSlot.ts';

/** Captures' toolbar slot and New, pointed at Bookings' strip and its New booking page. */
export function BookingsPagesScope({ children }: { readonly children: ReactNode }) {
  const slot = useBookingsToolbarSlot();
  const newPage = useBookingsNewPage();
  return (
    <CapturesToolbarSlot.Provider value={slot}>
      <CapturesCreateContext.Provider
        value={{ label: strings.newPage, isPending: false, ...(newPage === undefined ? {} : { create: newPage }) }}
      >
        {children}
      </CapturesCreateContext.Provider>
    </CapturesToolbarSlot.Provider>
  );
}
