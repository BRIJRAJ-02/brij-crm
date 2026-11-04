// Brief
// Purpose: Settings › Scheduling's frame for a screen Bookings shows as a tab (Availability, Routing): the settings TopBar with the page's title, and the screen under it.
// Main task: give the screen what Bookings' frame gives it (a place in the TopBar for its one primary action), so the same screen works in both places with no second copy.
// Leaves out: the screen itself and its loading (each route hands those in), and Bookings' tab strip (Settings' sidebar is the navigation here).
import { useState, type ReactNode } from 'react';
import { BookingsActionSlot, BookingsToolbarSlot } from '../bookings/toolbarSlot.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for SchedulingSettingsPage. */
export interface SchedulingSettingsPageProps {
  /** The page's h1 ("Availability"). */
  readonly title: string;
  readonly isLoading?: boolean;
  /**
   * The screen's tools go in the TopBar too, before its action, where Bookings' strip end holds them (Routing's
   * Overview · Decisions · Skills · Test); without it they open the body (Availability's schedule switcher).
   */
  readonly hasToolsInBar?: boolean;
  /** The screen Bookings shows as a tab, which portals its primary action into the TopBar's end, as it does there. */
  readonly children: ReactNode;
}

/**
 * A Bookings screen as a settings page (5 November 2026: every setting under Settings, Bookings' tabs kept as
 * shortcuts to the same screens). The screen draws its own body edge to edge, as it does in the tab's panel, and
 * portals its primary action ("New schedule") into the TopBar's end through the slot Bookings' frame provides there.
 */
export function SchedulingSettingsPage({
  title,
  isLoading = false,
  hasToolsInBar = false,
  children,
}: SchedulingSettingsPageProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [tools, setTools] = useState<HTMLElement | null>(null);
  return (
    <SettingsPage
      title={title}
      fillsView
      actions={
        isLoading ? undefined : (
          <>
            {hasToolsInBar && <div ref={setTools} />}
            <div ref={setSlot} />
          </>
        )
      }
    >
      <BookingsToolbarSlot value={hasToolsInBar ? tools : null}>
        <BookingsActionSlot value={slot}>{children}</BookingsActionSlot>
      </BookingsToolbarSlot>
    </SettingsPage>
  );
}
