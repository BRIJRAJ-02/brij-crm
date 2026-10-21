// Brief
// Purpose: Bookings' calendars beside the week and the list (spec 0024 milestone 5), as Google Calendar keeps them: each account's calendars as boxes in their colours, and which one takes new bookings.
// Main task: show one calendar, several or all on this view, and move new bookings to another calendar (Make default).
// Leaves out: the calendars' own switches (Settings › Calendars), and a month to jump dates (the week's arrows and Today do that).
import type { CalendarAccountView, CalendarListState, CalendarsHeld } from '@crm/data';
import { useCalendarList } from '@crm/data/react';
import {
  AsideLayout,
  Button,
  ButtonLink,
  Callout,
  CalendarList,
  Link,
  Skeleton,
  type CalendarListAccount,
} from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { calendarSettingsHref } from '../settings/nav.ts';
import type { BookingsSearch } from './search.ts';
import { strings } from './strings.ts';

/** Where the open or folded panel is kept, per browser. */
const PANEL_KEY = 'crm.bookings.calendarsPanel';

/** The member's own choice in this browser: folded, open, or none yet (storage may be blocked: none). */
function readChoice(): 'folded' | 'open' | undefined {
  try {
    const kept = globalThis.localStorage.getItem(PANEL_KEY);
    return kept === 'folded' || kept === 'open' ? kept : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the member's choice in this browser, where storage allows. */
function writeChoice(choice: 'folded' | 'open'): void {
  try {
    globalThis.localStorage.setItem(PANEL_KEY, choice);
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
}

/**
 * The panel's open state: folded or open beside the view, or, on a narrow page, its sheet. Until the member
 * chooses, it opens only when a calendar is connected, since with none it would hold nothing but a prompt
 * squeezing the week (the owner, 22 October 2026); their choice is kept after that.
 */
export function useCalendarsPanel(hasCalendar: boolean) {
  const [choice, setChoice] = useState(readChoice);
  const [isNarrow, setNarrow] = useState(false);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const isBesideOpen = choice === undefined ? hasCalendar : choice === 'open';
  return {
    isOpen: isNarrow ? isSheetOpen : isBesideOpen,
    isNarrow,
    setNarrow,
    toggle: () => {
      if (isNarrow) {
        setSheetOpen((was) => !was);
        return;
      }
      const next = isBesideOpen ? 'folded' : 'open';
      writeChoice(next);
      setChoice(next);
    },
    closeSheet: () => setSheetOpen(false),
  };
}

/** The panel's state, as `useCalendarsPanel` answers it. */
export type CalendarsPanel = ReturnType<typeof useCalendarsPanel>;

/**
 * The bar's Calendars button: folds or opens the panel beside the view, or opens it as a sheet on a phone. With no
 * calendar connected it is one quiet Connect calendar link instead, since the panel would hold only that prompt.
 */
export function CalendarsToggle({
  panel,
  slug,
  hasNoCalendar,
}: {
  readonly panel: CalendarsPanel;
  readonly slug: string;
  /** The calendars read and none is connected. */
  readonly hasNoCalendar: boolean;
}) {
  if (hasNoCalendar)
    return (
      <ButtonLink
        variant="ghost"
        icon="calendar-plus"
        label={strings.connectCalendar}
        isLabelCollapsible
        href={calendarSettingsHref(slug)}
      >
        {strings.connectCalendarShort}
      </ButtonLink>
    );
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
  /** Fills the view's height (the week grid). */
  readonly isFill?: boolean;
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
  isFill = false,
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
      isFill={isFill}
    >
      {children}
    </AsideLayout>
  );
}
