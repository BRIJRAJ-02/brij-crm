// Brief
// Purpose: a colleague's calendar health as a small chip (spec 0037, AC-1308, AC-1314, AC-1315), the one way the
// Members page, the Team week and rotations say whether scheduling around someone can be trusted.
// Main task: read at a glance who needs to reconnect, the time it began on hover or focus, and (from the row's menu)
// ask them to reconnect.
// Leaves out: which account or calendar broke, and why (the member's own Settings says so; colleagues never see it).
import {
  dataError,
  type CalendarHealthState,
  type CalendarHealthStatus,
  type DataLayer,
  type MemberCalendarHealth,
  type SchedulingAccessStore,
} from '@crm/data';
import { Badge, MenuItem, memoIntl, Skeleton, Tooltip, useFormatSettings, VisuallyHidden } from '@crm/ui';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { calendarHealthStrings as words } from './calendar-health-strings.ts';

/** Each status's words and dot: green working, orange needs them, red broken; none for no calendar. */
const LOOKS: Readonly<
  Record<CalendarHealthStatus, { readonly label: string; readonly dot?: 'green' | 'orange' | 'red' }>
> = {
  connected: { label: words.connected, dot: 'green' },
  skipped: { label: words.skipped, dot: 'orange' },
  reconnect: { label: words.reconnect, dot: 'red' },
  none: { label: words.none },
};

/** Whether Ask to reconnect is offered for a status (AC-1309): Reconnect needed or Some calendars skipped. */
export const needsReconnect = (health: MemberCalendarHealth): boolean =>
  health.status === 'reconnect' || health.status === 'skipped';

/**
 * The scheduling store: at once when a loader opened it, else opened here (its own chunk, never the first load), and
 * only while `isWanted` (a screen whose reader sees no chips never loads it). `null` when its chunk failed to load:
 * the chips then say they're unavailable rather than load for ever.
 */
export function useSchedulingStore(data: DataLayer, isWanted = true): SchedulingAccessStore | null | undefined {
  const [store, setStore] = useState<SchedulingAccessStore | null | undefined>(() => data.scheduling.loaded());
  useEffect(() => {
    if (store !== undefined || !isWanted) return undefined;
    let isCurrent = true;
    data.scheduling.open().then(
      (opened) => {
        if (isCurrent) setStore(opened);
      },
      () => {
        if (isCurrent) setStore(null);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, store, isWanted]);
  return isWanted ? store : undefined;
}

/**
 * Some members' calendar health, held while the screen shows them: the store reads them in one call, and a status
 * changing re-renders. Absent from the map until the store has loaded; an error for each when it couldn't.
 */
export function useCalendarHealth(
  store: SchedulingAccessStore | null | undefined,
  slug: string,
  memberIds: readonly string[],
): ReadonlyMap<string, CalendarHealthState> {
  const key = memberIds.join(',');
  const held = useMemo(
    () =>
      store === undefined
        ? []
        : key
            .split(',')
            .flatMap((id) =>
              id === '' ? [] : [[id, store === null ? UNAVAILABLE : store.health.held(slug, id)] as const],
            ),
    [store, slug, key],
  );
  const [version, changed] = useReducer((count: number) => count + 1, 0);
  // One map per change, so a screen's memo over it holds between changes.
  const shown = useMemo(
    () => new Map(held.map(([id, each]) => [id, each.getSnapshot()])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is what moves when a held status changes.
    [held, version],
  );
  // What the first render of these members drew, to tell whether anything landed before the subscribing.
  const first = useMemo(() => held.map(([, each]) => each.getSnapshot()), [held]);
  useEffect(() => {
    const releases = held.map(([, each]) => each.retain());
    const stops = held.map(([, each]) => each.subscribe(changed));
    if (held.some(([, each], index) => each.getSnapshot() !== first[index])) changed();
    return () => {
      for (const stop of stops) stop();
      for (const release of releases) release();
    };
  }, [held, first]);
  return shown;
}

/** What a member's chip holds when the store's chunk couldn't load: unavailable, never loading for ever. */
const UNAVAILABLE_STATE: CalendarHealthState = {
  status: 'error',
  error: dataError('API_UNAVAILABLE', 'The calendar statuses couldn’t load.'),
};
const UNAVAILABLE = {
  subscribe: () => () => undefined,
  getSnapshot: () => UNAVAILABLE_STATE,
  retain: () => () => undefined,
};

/** Props for CalendarHealthChip. */
export interface CalendarHealthChipProps {
  /** The member's status as the store holds it; undefined while the store loads. */
  readonly state: CalendarHealthState | undefined;
  /** The member's name, for the tooltip and screen readers. */
  readonly name: string;
  /** Says nothing while all is well (Connected): rows where only trouble should stand out. */
  readonly isQuiet?: boolean;
  /** Shows Hidden for a member outside the reader's See reach (AC-1315); otherwise nothing shows for them. */
  readonly showsHidden?: boolean;
}

/**
 * A member's calendar health as a Badge with its state's dot and words (never colour alone), the time it began in
 * a tooltip and for screen readers. Loading is a short skeleton; a failed read says Unavailable where the chip has a
 * place of its own (a column) and nothing where it only flags trouble.
 */
export function CalendarHealthChip({ state, name, isQuiet = false, showsHidden = false }: CalendarHealthChipProps) {
  const { locale, timeZone } = useFormatSettings();
  if (state === undefined || state.status === 'loading') return isQuiet ? null : <Skeleton width="short" />;
  if (state.status === 'error') return isQuiet ? null : <Badge text={words.unavailable} isWhole />;
  if (state.status === 'hidden') {
    if (!showsHidden) return null;
    return (
      <>
        <Tooltip content={words.hiddenHint(name)} isTextTrigger>
          <Badge text={words.hidden} isWhole />
        </Tooltip>
        <VisuallyHidden>{`, ${words.hiddenHint(name)}`}</VisuallyHidden>
      </>
    );
  }
  const { health } = state;
  if (isQuiet && health.status === 'connected') return null;
  const look = LOOKS[health.status];
  const badge = <Badge text={look.label} isWhole {...(look.dot === undefined ? {} : { dot: look.dot })} />;
  const hint =
    health.status === 'none'
      ? words.noneHint
      : health.since === undefined || health.status === 'connected'
        ? undefined
        : words.since(sinceWords(health.since, locale, timeZone));
  if (hint === undefined) return badge;
  return (
    <>
      <Tooltip content={hint} isTextTrigger>
        {badge}
      </Tooltip>
      <VisuallyHidden>{`, ${hint}`}</VisuallyHidden>
    </>
  );
}

/** "29 Oct, 09:00": when a status began, in the reader's language and zone. */
function sinceWords(at: string, locale: string, timeZone: string): string {
  return memoIntl(
    `calendar-health-since:${locale}:${timeZone}`,
    () =>
      new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone }),
  ).format(new Date(at));
}

/**
 * The row menu's Ask to reconnect (AC-1309), when the member's status asks for it: once asked in this tab (or by
 * anyone today), it stays, disabled, saying so.
 */
export function askReconnectItem(state: CalendarHealthState | undefined) {
  if (state?.status !== 'ready' || !needsReconnect(state.health)) return null;
  return state.asked ? (
    <MenuItem id="ask-reconnect" icon="mail" isDisabled>
      {words.asked}
    </MenuItem>
  ) : (
    <MenuItem id="ask-reconnect" icon="mail">
      {words.ask}
    </MenuItem>
  );
}

/** Whether a row offers Ask to reconnect at all (so a row with nothing else still gets its menu). */
export const offersAsk = (state: CalendarHealthState | undefined): boolean =>
  state?.status === 'ready' && needsReconnect(state.health);

/** Sends Ask to reconnect for a member; the store toasts how it went. */
export function askReconnect(
  store: SchedulingAccessStore | null | undefined,
  slug: string,
  memberId: string,
  name: string,
) {
  if (store === undefined || store === null) return;
  void store.health.ask(slug, memberId, { asked: words.askedToast(name) });
}
