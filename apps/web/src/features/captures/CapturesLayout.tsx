// Brief
// Purpose: the frame of Booking pages and of Forms (spec 0034), in People's chrome so nothing moves from page to page: the TopBar (tile, title, count, New) and the bar People's views take, holding the page's search.
// Main task: hold New and the search for the whole page, so the list loading under them remounts neither.
// Leaves out: the list itself (the child route draws it), the editors (routes of their own) and Bookings (its own tabs).
import { ViewBar } from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { CapturesCreateProvider } from './create.tsx';
import { CapturesTopBar } from './CapturesTopBar.tsx';
import type { CapturePage } from './pages.ts';
import { CapturesToolbarSlot } from './toolbarSlot.ts';

/** Props for CapturesLayout. */
export interface CapturesLayoutProps {
  readonly slug: string;
  /** Which list page: Booking pages (`links`) or Forms. */
  readonly page: CapturePage;
  /** The child route's page (an `Outlet`): the list, or its loading and error states. */
  readonly children: ReactNode;
}

/**
 * The page's frame: its New (and New booking page's dialog), the TopBar, and the bar whose end the list portals
 * its search into, around the child route. A child that draws its own WorkspacePage draws only its body here.
 */
export function CapturesLayout({ slug, page, children }: CapturesLayoutProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <CapturesCreateProvider slug={slug} page={page}>
      <CapturesToolbarSlot.Provider value={slot}>
        <WorkspacePage
          currentPage={page === 'links' ? 'booking_pages' : 'forms'}
          page={{
            topBar: <CapturesTopBar slug={slug} page={page} />,
            viewBar: (
              <ViewBar>
                <div ref={setSlot} />
              </ViewBar>
            ),
            body: children,
          }}
        />
      </CapturesToolbarSlot.Provider>
    </CapturesCreateProvider>
  );
}
