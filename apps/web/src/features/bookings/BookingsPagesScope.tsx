// Brief
// Purpose: lets Captures › Links' list draw inside Bookings › Pages: its search in Bookings' strip, its empty state's
// New as Bookings' New booking page, and the tab's own actions at the TopBar's end (Team links, then New page).
// Main task: hand the Links screen the two things the Captures layout normally gives it, from the Bookings layout.
// Leaves out: the list itself (LinksScreen) and the dialog (the Bookings layout holds it).
import { Button, ButtonGroup } from '@crm/ui';
import { useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CapturesCreateContext } from '../captures/create.tsx';
import { CapturesToolbarSlot } from '../captures/toolbarSlot.ts';
import { strings } from '../booking/strings.ts';
import { TeamLinksMenu } from '../booking/TeamLinksMenu.tsx';
import { useBookingsActionSlot, useBookingsNewPage, useBookingsToolbarSlot } from './toolbarSlot.ts';

/** Captures' toolbar slot and New, pointed at Bookings' strip and its New booking page; Pages' actions in the TopBar. */
export function BookingsPagesScope({ children }: { readonly children: ReactNode }) {
  const slot = useBookingsToolbarSlot();
  const newPage = useBookingsNewPage();
  return (
    <CapturesToolbarSlot.Provider value={slot}>
      <CapturesCreateContext.Provider
        value={{
          label: strings.newPage,
          isPending: false,
          ...(newPage === undefined ? {} : { create: () => newPage() }),
        }}
      >
        <PagesActions />
        {children}
      </CapturesCreateContext.Provider>
    </CapturesToolbarSlot.Provider>
  );
}

/** Pages' own actions at the TopBar's end (the mock's A9): Team links, then New page, the screen's one primary. */
function PagesActions() {
  const { slug = '' } = useParams({ strict: false });
  const target = useBookingsActionSlot();
  const newPage = useBookingsNewPage();
  if (target === null || newPage === undefined) return null;
  return createPortal(
    <ButtonGroup layout="line" label={strings.pagesActions}>
      <TeamLinksMenu slug={slug} onNew={(kind) => newPage(kind)} />
      <Button
        variant="primary"
        icon="plus"
        label={strings.pageCard.newPage}
        isLabelCollapsible
        onPress={() => newPage()}
      >
        {strings.pageCard.newPage}
      </Button>
    </ButtonGroup>,
    target,
  );
}
