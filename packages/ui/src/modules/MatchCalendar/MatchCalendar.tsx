import { useRef, useState } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { SlotList, type Slot } from '../SlotList/SlotList.tsx';
import styles from './MatchCalendar.module.css';
import { strings } from './strings.ts';

/**
 * The flow's four states in one dialog: `why` (what it does and what it
 * reads, before Google), `waiting` (the two calendars being matched), `matched`
 * (the best shared time, offered) and `unmatched` or `failed` (nothing in
 * common, or the calendar couldn't be read).
 */
export type MatchCalendarStep = 'why' | 'waiting' | 'matched' | 'unmatched' | 'failed';

/** One of the two people being matched: the host, or the visitor once Google says who they are. */
export interface MatchCalendarParty {
  readonly name: string;
  /** Their picture, from our origin; the initials stand in without one. */
  readonly image?: string;
}

/** The other matching times of one day, under the day's name. */
export interface MatchCalendarDay {
  readonly day: string;
  readonly times: readonly Slot[];
}

/** What the match found. */
export interface MatchCalendarResult {
  /** How many times both are free, so the answer doesn't read as a lucky guess. */
  readonly count: number;
  /** The one offered first. */
  readonly best: Slot;
  /** When it is, in words: "9:30 AM on Tue 20 Oct". */
  readonly when: string;
  /** The rest, grouped by day, shown only when the visitor asks for them. */
  readonly days?: readonly MatchCalendarDay[];
}

/** Props for MatchCalendar. */
export interface MatchCalendarProps {
  readonly step: MatchCalendarStep;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly host: MatchCalendarParty;
  /** The visitor, once we know them; a held space before that. */
  readonly visitor?: MatchCalendarParty;
  /** Where Continue with Google goes (this visit only, then back). Without one, `why` and `failed` offer no way out but Close. */
  readonly connectHref?: string;
  /** The match, for `matched`. */
  readonly result?: MatchCalendarResult;
  /** Books a matching time. It closes the dialog and the page goes on to its details step. */
  readonly onBook?: (id: string) => void;
  /** Shows every time the host is open, for `unmatched`; it closes the dialog itself. */
  readonly onShowAll?: () => void;
}

/** The mark between the two faces, by state; `waiting` draws its own moving dots instead. */
const MIDDLE: Readonly<Record<MatchCalendarStep, IconName | undefined>> = {
  why: 'arrow-left-right',
  waiting: undefined,
  matched: 'circle-check',
  unmatched: 'circle-slash',
  failed: 'triangle-alert',
};

/** How many dots travel between the faces while the calendars are matched. */
const DOTS = [0, 1, 2];

/** One side of the pair: their picture, or a held space until we know them, with their name under it. */
function Face({
  party,
  side,
  isStill,
}: {
  readonly party?: MatchCalendarParty;
  readonly side: 'host' | 'visitor';
  readonly isStill: boolean;
}) {
  return (
    <span className={styles.face} data-side={side}>
      <span className={styles.portrait}>
        {party === undefined ? (
          <Skeleton shape="circle" size="xl" isStill={isStill} />
        ) : (
          <Avatar
            name={party.name}
            size="xl"
            {...(party.image === undefined ? {} : { src: party.image })}
            isDecorative
          />
        )}
      </span>
      <span className={styles.name}>{party?.name ?? strings.yourCalendar}</span>
    </span>
  );
}

/** The sentence the dialog leads with. */
function lead(step: MatchCalendarStep, host: string, result: MatchCalendarResult | undefined): string {
  switch (step) {
    case 'why':
      return strings.whyLead(host);
    case 'waiting':
      return strings.waitingLead;
    case 'matched':
      return result === undefined ? strings.waitingLead : strings.matchedLead(result.when);
    case 'unmatched':
      return strings.noneLead(host);
    case 'failed':
      return strings.failedLead;
  }
}

/** The quieter line under it. */
function note(step: MatchCalendarStep, result: MatchCalendarResult | undefined): string {
  switch (step) {
    case 'why':
      return strings.whyNote;
    case 'waiting':
      return strings.waitingNote;
    case 'matched':
      // The claim is the server's Best rule; without one, the first shared time is offered without it.
      return result?.best.isBest === true ? strings.matchedWhy : strings.matchedSoonest;
    case 'unmatched':
      return strings.noneNote;
    case 'failed':
      return strings.failedNote;
  }
}

/**
 * Match with your calendar on a booking page: the dialog behind the page's
 * call to action, in four states. It says what it does and what it reads, goes
 * to Google for this visit only, holds its own shape while the two calendars
 * are matched (the host and the visitor side by side, with dots travelling
 * between them), then offers the best shared time to book, with the rest a
 * press away. Nothing in common, or a calendar we couldn't read, says so and
 * sends the visitor back to the page's own times.
 *
 * It creates no account and keeps nothing: the connection lasts the visit
 * (spec 0028). Controlled, because the trip to Google reloads the page: the
 * page reopens it on the way back.
 */
export function MatchCalendar({
  step,
  isOpen,
  onOpenChange,
  host,
  visitor,
  connectHref,
  result,
  onBook,
  onShowAll,
}: MatchCalendarProps) {
  const [showsOthers, setShowsOthers] = useState(false);
  const others = useRef<HTMLDivElement>(null);
  const days = result?.days ?? [];
  const hasOthers = days.some((group) => group.times.length > 0);

  // Each visit to the dialog starts on its answer, not on the list it opened last time.
  const setOpen = (next: boolean) => {
    if (!next) setShowsOthers(false);
    onOpenChange(next);
  };

  const actions =
    step === 'why' ? (
      <>
        <Button slot="close">{strings.notNow}</Button>
        {connectHref !== undefined && (
          <ButtonLink href={connectHref} provider="google" variant="primary">
            {strings.continue}
          </ButtonLink>
        )}
      </>
    ) : step === 'waiting' ? (
      <Button slot="close">{strings.close}</Button>
    ) : step === 'matched' ? (
      <>
        <Button slot="close">{strings.notNow}</Button>
        {hasOthers && !showsOthers && (
          <Button
            onPress={() => {
              setShowsOthers(true);
              // The button goes with its press: focus moves into the times it just drew.
              focusLater(() => others.current?.querySelector<HTMLElement>('button'));
            }}
          >
            {strings.others}
          </Button>
        )}
        {result !== undefined && onBook !== undefined && (
          <Button variant="primary" onPress={() => onBook(result.best.id)}>
            {strings.book}
          </Button>
        )}
      </>
    ) : step === 'unmatched' ? (
      <>
        <Button slot="close">{strings.close}</Button>
        {onShowAll !== undefined && (
          <Button
            variant="primary"
            onPress={() => {
              setOpen(false);
              onShowAll();
            }}
          >
            {strings.showAll}
          </Button>
        )}
      </>
    ) : (
      <>
        <Button slot="close">{strings.close}</Button>
        {connectHref !== undefined && (
          <ButtonLink href={connectHref} provider="google" variant="primary">
            {strings.retry}
          </ButtonLink>
        )}
      </>
    );

  const middle = MIDDLE[step];
  return (
    <Modal title={strings.title} isOpen={isOpen} onOpenChange={setOpen} actions={actions} icon="calendar-check">
      {/* The two of them, the same shape in every state, so the answer landing moves nothing. */}
      <div className={styles.pair} data-step={step} aria-hidden="true">
        <Face party={host} side="host" isStill />
        <span className={styles.middle}>
          {middle === undefined ? (
            <span className={styles.dots}>
              {DOTS.map((dot) => (
                <span key={dot} className={styles.dot} data-dot={dot} />
              ))}
            </span>
          ) : (
            <Icon name={middle} />
          )}
        </span>
        <Face party={visitor} side="visitor" isStill={step !== 'waiting'} />
      </div>
      <div className={styles.message} aria-busy={step === 'waiting'}>
        <p className={styles.lead}>{lead(step, host.name, result)}</p>
        {step === 'matched' && result !== undefined && (
          <p className={styles.count}>{strings.matchedCount(result.count)}</p>
        )}
        <p className={styles.note}>{note(step, result)}</p>
      </div>
      {showsOthers && hasOthers && (
        <div ref={others} className={styles.others} role="group" aria-label={strings.othersLabel}>
          {days.map((group) => (
            <SlotList
              key={group.day}
              variant="offers"
              layout="grid"
              heading={group.day}
              slots={group.times}
              value={undefined}
              onChange={(id) => onBook?.(id)}
            />
          ))}
        </div>
      )}
      {/* What changed under the visitor, said once the dialog is already open. */}
      <VisuallyHidden>
        <span role="status">
          {step === 'waiting'
            ? strings.waitingSaid
            : step === 'why'
              ? ''
              : `${lead(step, host.name, result)} ${step === 'matched' && result !== undefined ? strings.matchedCount(result.count) : note(step, result)}`}
        </span>
      </VisuallyHidden>
    </Modal>
  );
}

/** Props for MatchCalendarCta. */
export interface MatchCalendarCtaProps {
  readonly onPress: () => void;
  /**
   * While the page is still asking who the visitor is: the same box, held, so
   * the card under it never moves when the call to action fills it.
   */
  readonly isLoading?: boolean;
}

/**
 * The booking page's call to action above the card: Match with your calendar,
 * the row's width, which opens MatchCalendar (the owner, 25 October 2026: "a
 * big CTA that clearly says Match with your calendar"). It replaces the small
 * Connect your calendar link for a visitor we don't know; a visitor we know
 * reaches the same dialog from their own tag's menu.
 */
export function MatchCalendarCta({ onPress, isLoading = false }: MatchCalendarCtaProps) {
  if (isLoading) {
    return (
      <div className={styles.cta} aria-busy="true">
        <span className={styles.ctaHold}>
          <Skeleton shape="fill" />
        </span>
        <span className={styles.hintHold}>
          <Skeleton shape="text" width="medium" />
        </span>
      </div>
    );
  }
  return (
    <div className={styles.cta}>
      <Button variant="primary" size="xl" icon="calendar-check" isFullWidth="center" onPress={onPress}>
        {strings.cta}
      </Button>
      <p className={styles.hint}>{strings.ctaHint}</p>
    </div>
  );
}
