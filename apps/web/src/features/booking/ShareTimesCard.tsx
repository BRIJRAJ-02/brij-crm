// Brief
// Purpose: Share specific times (the bookings area, 5 November 2026; SavvyCal's "share specific times"): the host picks
//   2 to 5 of the page's open times and sends a link that offers only those, or a short text to paste into an email.
// Main task: tick a few times, then Copy link or Copy text.
// Leaves out: holding the times (they stay open to anyone until one is booked; the link says what is still free when
//   it opens), several lengths at once (the page's first length; the link carries it), and a draft or paused page,
//   which has no times to offer yet.
import type { DataLayer } from '@crm/data';
import {
  Button,
  ButtonGroup,
  EmptyState,
  SectionBar,
  Card,
  ChoiceChips,
  CopyButton,
  InfoTip,
  Skeleton,
  useFormatSettings,
} from '@crm/ui';
import { useEffect, useMemo, useState } from 'react';
import { shareTimesStrings as strings } from './share-times-strings.ts';

/** The fewest and most times a link offers (the owner, 5 November 2026: 2 to 5). */
export const SHARE_TIMES_MIN = 2;
export const SHARE_TIMES_MAX = 5;

/** How many days one read covers; "Show the next week" reads one more. */
const WEEK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Props for ShareTimesCard. */
export interface ShareTimesCardProps {
  readonly data: DataLayer;
  readonly publicKey: string;
  readonly title: string;
  /** The length the link offers: the page's first. */
  readonly duration: number;
  /** The page's address, which the link adds `?times=` and `&len=` to. */
  readonly link: string;
  /** Live and taking bookings: otherwise there is nothing to offer, and the card says so. */
  readonly isLive: boolean;
  /** Published but turned off: the card says to turn it on, not to publish it. */
  readonly isPaused?: boolean;
}

/** The link that offers only `times` (ISO instants) at `duration` minutes, read by the public page (`at-param.ts`). */
export function timesLink(link: string, times: readonly string[], duration: number): string {
  const url = new URL(link);
  url.searchParams.set('times', [...times].sort().join(','));
  url.searchParams.set('len', String(duration));
  return url.href;
}

/** What a read of the open times stands at. */
type TimesRead =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly times: readonly string[] };

/** The card: the open times by day as chips, at most five chosen, then Copy link and Copy text. */
export function ShareTimesCard({
  data,
  publicKey,
  title,
  duration,
  link,
  isLive,
  isPaused = false,
}: ShareTimesCardProps) {
  const { locale, timeZone } = useFormatSettings();
  const [weeks, setWeeks] = useState(1);
  const [attempt, setAttempt] = useState(0);
  // An answer is kept with the read it answers, so a new read shows loading without being set in the effect.
  const key = `${publicKey}|${String(duration)}|${timeZone}|${String(weeks)}|${String(attempt)}`;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly read: TimesRead } | undefined>(undefined);
  const read = useMemo((): TimesRead => (answer?.key === key ? answer.read : { status: 'loading' }), [answer, key]);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  // The day whose sixth time was refused: its chips say why, under them.
  const [refusedDay, setRefusedDay] = useState<string | undefined>(undefined);
  // The last times read, kept on screen while a longer read (Show the next week) is out, so nothing ticked vanishes.
  const [lastTimes, setLastTimes] = useState<readonly string[] | undefined>(undefined);
  if (read.status === 'ready' && read.times !== lastTimes) {
    setLastTimes(read.times);
    // A ticked time booked meanwhile leaves the pick, so it never goes into the link or counts toward five.
    const open = new Set(read.times);
    if (chosen.some((start) => !open.has(start))) setChosen(chosen.filter((start) => open.has(start)));
  }
  const shownTimes = read.status === 'ready' ? read.times : lastTimes;
  const isLoadingMore = read.status === 'loading' && lastTimes !== undefined;
  useEffect(() => {
    if (!isLive) return;
    const controller = new AbortController();
    const from = new Date();
    const to = new Date(from.getTime() + weeks * WEEK_DAYS * DAY_MS);
    data.bookingPages
      .openTimes(
        publicKey,
        { from: from.toISOString(), to: to.toISOString(), duration, tz: timeZone },
        controller.signal,
      )
      .then(
        (times) => {
          if (!controller.signal.aborted) setAnswer({ key, read: { status: 'ready', times } });
        },
        () => {
          if (!controller.signal.aborted) setAnswer({ key, read: { status: 'error' } });
        },
      );
    return () => controller.abort();
  }, [data, publicKey, duration, timeZone, weeks, isLive, key]);
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone }),
    [locale, timeZone],
  );
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }),
    [locale, timeZone],
  );
  const zoneName = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? timeZone,
    [locale, timeZone],
  );
  const days = useMemo(() => {
    if (shownTimes === undefined) return [];
    const byDay = new Map<string, string[]>();
    for (const start of shownTimes) {
      const day = dayFormat.format(new Date(start));
      byDay.set(day, [...(byDay.get(day) ?? []), start]);
    }
    return [...byDay];
  }, [shownTimes, dayFormat]);
  const sorted = [...chosen].sort();
  const isEnough = sorted.length >= SHARE_TIMES_MIN;
  const shareLink = timesLink(link, sorted, duration);
  const text = [
    strings.textLead(title, duration),
    ...sorted.map((start) => `• ${dayFormat.format(new Date(start))}, ${timeFormat.format(new Date(start))}`),
    strings.textZone(zoneName),
    strings.textPick(shareLink),
  ].join('\n');
  // What the card says under its title: not live yet, no times, or what Copy waits for (said, not only on hover).
  const line = !isLive
    ? isPaused
      ? strings.notOn
      : strings.notLive
    : shownTimes !== undefined && days.length === 0
      ? strings.noTimes
      : !isEnough
        ? strings.pickMore
        : strings.picked(sorted.length);
  return (
    <Card title={strings.title} actions={<InfoTip label={strings.title}>{strings.help}</InfoTip>} description={line}>
      {isLive && shownTimes === undefined && read.status === 'loading' && <Skeleton lines={3} />}
      {isLive && read.status === 'error' && (
        <EmptyState tone="error" title={strings.failed} onRetry={() => setAttempt((count) => count + 1)} />
      )}
      {isLive && shownTimes !== undefined && read.status !== 'error' && (
        <>
          {days.map(([day, starts]) => (
            <ChoiceChips
              key={day}
              label={day}
              choices={starts.map((start) => ({ id: start, label: timeFormat.format(new Date(start)) }))}
              // Only this day's chosen times are this group's; the others stay as they are.
              selected={chosen.filter((start) => starts.includes(start))}
              {...(refusedDay === day ? { error: strings.tooMany } : {})}
              onChange={(ids) => {
                const others = chosen.filter((start) => !starts.includes(start));
                const next = [...others, ...ids];
                if (next.length > SHARE_TIMES_MAX) {
                  setRefusedDay(day);
                  return;
                }
                setRefusedDay(undefined);
                setChosen(next);
              }}
            />
          ))}
          <SectionBar
            start={
              <Button
                variant="ghost"
                icon="calendar-plus"
                isPending={isLoadingMore}
                onPress={() => setWeeks((count) => count + 1)}
              >
                {strings.nextWeek}
              </Button>
            }
          />
          <ButtonGroup label={strings.actions} layout="row">
            <CopyButton value={shareLink} label={strings.copyLink} isDisabled={!isEnough} />
            <CopyButton value={text} label={strings.copyText} isDisabled={!isEnough} />
          </ButtonGroup>
        </>
      )}
    </Card>
  );
}
