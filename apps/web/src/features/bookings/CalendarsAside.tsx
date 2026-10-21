// Brief
// Purpose: Bookings' calendars beside the week and the list (spec 0024 milestone 5), as Google Calendar keeps them: each account's calendars as boxes in their colours, and which one takes new bookings.
// Main task: show one calendar, several or all on this view, and move new bookings to another calendar (Make default).
// Leaves out: the calendars' own switches (Settings › Calendars), and a month to jump dates (the week's arrows and Today do that).
import type { CalendarAccountView, CalendarListState, CalendarsHeld } from '@crm/data';
import { useCalendarList } from '@crm/data/react';
import { AsideLayout, Button, Callout, CalendarList, Link, Skeleton, type CalendarListAccount } from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { calendarSettingsHref } from '../settings/nav.ts';
import type { BookingsSearch } from './search.ts';
import { strings } from './strings.ts';

/** Where the open or folded panel is kept, per browser. */
const PANEL_KEY = 'crm.bookings.calendarsPanel';

/** Whether the panel was folded in this browser (storage may be blocked: then it shows). */
function readFolded(): boolean {
  try {
    return globalThis.localStorage.getItem(PANEL_KEY) === 'folded';
  } catch {
    return false;
  }
}

/** Keeps the panel folded or open in this browser, where storage allows. */
function writeFolded(folded: boolean): void {
  try {
    if (folded) globalThis.localStorage.setItem(PANEL_KEY, 'folded');
    else globalThis.localStorage.removeItem(PANEL_KEY);
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
}

/** The panel's open state: folded or open beside the view (kept), or, on a narrow page, its sheet. */
export function useCalendarsPanel() {
  const [isFolded, setFolded] = useState(readFolded);
  const [isNarrow, setNarrow] = useState(false);
  const [isSheetOpen, setSheetOpen] = useState(false);
  return {
    isOpen: isNarrow ? isSheetOpen : !isFolded,
    isNarrow,
    setNarrow,
    toggle: () => {
      if (isNarrow) {
        setSheetOpen((was) => !was);
        return;
      }
      writeFolded(!isFolded);
      setFolded(!isFolded);
    },
    closeSheet: () => setSheetOpen(false),
  };
}

/** The panel's state, as `useCalendarsPanel` answers it. */
export type CalendarsPanel = ReturnType<typeof useCalendarsPanel>;

/** The bar's Calendars button: folds or opens the panel beside the view, or opens it as a sheet on a phone. */
export function CalendarsToggle({ panel }: { readonly panel: CalendarsPanel }) {
  // On a phone the label folds away (the icon stays, named Calendars), so the week's range and arrows wrap less, as
  // they sat before the panel came (round 6).
  return (
    <Button
      variant="ghost"
      icon={panel.isOpen && !panel.isNarrow ? 'panel-left-close' : 'panel-left-open'}
      label={strings.calendars}
      isLabelCollapsible
      isExpanded={panel.isOpen}
      onPress={panel.toggle}
    >
      {strings.calendars}
    </Button>
  );
}

/** Each account's calendars that show on the member's week (Settings › Calendars says which). */
export function accountsOnWeek(state: CalendarListState): readonly CalendarAccountView[] {
  if (state.status !== 'ready') return [];
  return state.accounts
    .map((account) => ({ ...account, calendars: account.calendars.filter((calendar) => calendar.showInWeek) }))
    .filter((account) => account.calendars.length > 0);
}

/** Props for CalendarsFrame. */
export interface CalendarsFrameProps {
  readonly slug: string;
  readonly search: BookingsSearch;
  readonly calendars: CalendarsHeld<CalendarListState>;
  readonly panel: CalendarsPanel;
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
  /** Make default: new bookings go to this calendar (at once, put back with a toast when refused). */
  readonly onMakeDefault: (calendarId: string) => void;
  /** Puts away the notice that new bookings moved to another calendar. */
  readonly onDismissNotice: () => void;
  /** No calendars panel: the view shows no calendar events (List › Bookings), so the boxes would change nothing. */
  readonly isHidden?: boolean;
  readonly children: ReactNode;
}

/** The view with the calendars panel at its start. */
export function CalendarsFrame({
  slug,
  search,
  calendars,
  panel,
  onSearch,
  onMakeDefault,
  onDismissNotice,
  isHidden = false,
  children,
}: CalendarsFrameProps) {
  const state = useCalendarList(calendars);
  const accounts = accountsOnWeek(state);
  const all = accounts.flatMap((account) => account.calendars);
  const picked = search.cal === undefined ? undefined : new Set(search.cal);
  const listed: CalendarListAccount[] = accounts.map((account) => ({
    id: account.id,
    provider: account.provider === 'google' ? 'google-calendar' : 'outlook',
    email: account.accountEmail,
    calendars: account.calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      hue: calendar.hue,
      isShown: picked === undefined || picked.has(calendar.id),
      isDefault: calendar.isDestination,
      canBeDefault: calendar.canBeDestination,
    })),
  }));
  const destination =
    state.status === 'ready'
      ? state.accounts.flatMap((account) => account.calendars).find((calendar) => calendar.isDestination)
      : undefined;
  const fellBack = state.status === 'ready' ? state.fellBack : undefined;
  const aside =
    state.status === 'loading' ? (
      <Skeleton lines={4} />
    ) : state.status === 'error' ? (
      <Callout tone="danger">{state.message === '' ? strings.calendarsFailed : state.message}</Callout>
    ) : state.accounts.length === 0 ? (
      <Callout tone="info" actions={<Link href={calendarSettingsHref(slug)}>{strings.connectCalendar}</Link>}>
        {strings.noCalendarConnected}
      </Callout>
    ) : (
      <>
        {fellBack !== undefined && destination !== undefined && (
          <Callout
            tone="info"
            actions={
              <Button variant="ghost" size="sm" onPress={onDismissNotice}>
                {strings.dismiss}
              </Button>
            }
          >
            {strings.movedTo(destination.name, fellBack.removedName)}
          </Callout>
        )}
        <CalendarList
          accounts={listed}
          onShownChange={(calendarId, isShown) => {
            const next = new Set(picked ?? all.map((calendar) => calendar.id));
            if (isShown) next.add(calendarId);
            else next.delete(calendarId);
            onSearch({ cal: next.size === all.length ? undefined : [...next] });
          }}
          onShowOnly={(calendarId) => onSearch({ cal: [calendarId] })}
          onShowAll={() => onSearch({ cal: undefined })}
          onMakeDefault={onMakeDefault}
        />
      </>
    );
  return (
    <AsideLayout
      aside={aside}
      asideLabel={strings.calendars}
      isAsideOpen={panel.isOpen && !isHidden}
      onAsideClose={panel.closeSheet}
      onNarrowChange={panel.setNarrow}
    >
      {children}
    </AsideLayout>
  );
}
