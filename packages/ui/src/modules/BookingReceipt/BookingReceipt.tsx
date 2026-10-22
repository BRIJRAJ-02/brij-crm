import { useEffect, useRef, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import type { ProductLogo } from '../AuthLayout/AuthLayout.tsx';
import { ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import { DescriptionList, type DescriptionItem } from '../../molecules/DescriptionList/DescriptionList.tsx';
import { BookingFoot } from '../BookingFrame/BookingFrame.tsx';
import styles from './BookingReceipt.module.css';
import { strings } from './strings.ts';

/** Where a booking stands. */
export type BookingReceiptState = 'confirmed' | 'cancelled' | 'past';

/** Props for BookingReceipt. */
export interface BookingReceiptProps {
  readonly state: BookingReceiptState;
  /** Right after booking: the heading reads "You're booked". */
  readonly isWelcome?: boolean;
  readonly hostName: string;
  readonly hostImage?: string;
  /** The date chip: "Tue", "20", "Oct". */
  readonly date: { readonly weekday: string; readonly day: string; readonly month: string };
  /** "12:30 – 1:00 PM". */
  readonly range: string;
  /** "Tuesday 20 October 2026 · Kolkata time (GMT+5:30)". */
  readonly when: string;
  /** "Tomorrow morning", for a booking still ahead. */
  readonly relative?: string;
  /** What, Who, Where and the note. */
  readonly facts: readonly DescriptionItem[];
  /** The call's address, once it has one: Join the call. */
  readonly joinUrl?: string;
  /** Add to calendar: Google, Outlook, and an .ics file. */
  readonly calendars?: { readonly google: string; readonly outlook: string; readonly ics: string };
  /** For a cancelled or past booking: a way to book again ("Book another time with Ada"). */
  readonly again?: { readonly label: string; readonly href: string };
  /** What the guest may change, at the card's foot while it's ahead (BookingChanges). */
  readonly changes?: ReactNode;
  /** A line over the card after a change ("Moved. Both calendars are updated…"): a Callout. */
  readonly notice?: ReactNode;
  /**
   * The Timefix wordmark under the card, as the hosted form ends: where it
   * goes (opened in a new tab) and its accessible name. Without it, the
   * booking page's own foot.
   */
  readonly brand?: { readonly href: string; readonly label: string; readonly logo?: ProductLogo };
}

/** The web app's own wordmark files (apps/web/public/brand). */
const TIMEFIX_LOGO: ProductLogo = {
  light: '/brand/timefix-wordmark-light.png',
  dark: '/brand/timefix-wordmark-dark.png',
};

/**
 * A guest's booking page (spec 0025, AC-674): the host with the state's mark,
 * a heading by state that takes focus as the page arrives, then one card:
 * the date chip beside the time, the whole date and zone and how soon; What,
 * Who and Where; and Join the call with Add to calendar while it's ahead.
 */
export function BookingReceipt({
  state,
  isWelcome = false,
  hostName,
  hostImage,
  date,
  range,
  when,
  relative,
  facts,
  joinUrl,
  calendars,
  again,
  changes,
  notice,
  brand,
}: BookingReceiptProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The heading takes focus as the page arrives, and again when the booking's state changes (cancelled from here).
  useEffect(() => heading.current?.focus(), [state]);
  const isLive = state === 'confirmed';
  const title =
    state === 'cancelled'
      ? strings.cancelled
      : state === 'past'
        ? strings.past
        : isWelcome
          ? strings.welcome
          : strings.confirmed;
  return (
    <main className={styles.root}>
      <div className={styles.column}>
        <header className={styles.head}>
          <span className={styles.avatar}>
            <Avatar name={hostName} size="lg" isDecorative {...(hostImage === undefined ? {} : { src: hostImage })} />
            <span className={styles.mark} data-state={state} aria-hidden="true">
              <Icon name={state === 'confirmed' ? 'check' : state === 'cancelled' ? 'x' : 'clock'} size="xs" />
            </span>
          </span>
          <h1 ref={heading} tabIndex={-1} className={styles.title}>
            {title}
          </h1>
        </header>
        {notice}
        <article className={styles.card} aria-label={strings.marks[state]}>
          <div className={styles.band} data-state={state}>
            <div className={styles.chip} data-live={isLive ? '' : undefined} aria-hidden="true">
              <span className={styles.chipWeekday}>{date.weekday}</span>
              <span className={styles.chipDay}>{date.day}</span>
              <span className={styles.chipMonth}>{date.month}</span>
            </div>
            <div className={styles.when}>
              <p className={styles.range}>{range}</p>
              <p className={styles.muted}>{when}</p>
              {isLive && relative !== undefined && <p className={styles.relative}>{relative}</p>}
            </div>
          </div>
          <div className={styles.facts}>
            <DescriptionList items={facts} />
          </div>
          {isLive && (joinUrl !== undefined || calendars !== undefined) && (
            <section className={styles.actions} aria-label={strings.addToCalendar}>
              {joinUrl !== undefined && (
                <ButtonLink variant="primary" size="lg" icon="video" href={joinUrl} isExternal isFullWidth="center">
                  {strings.join}
                </ButtonLink>
              )}
              {calendars !== undefined && (
                <div className={styles.calendars}>
                  <span className={styles.label}>{strings.addToCalendar}</span>
                  <div className={styles.links}>
                    <ButtonLink provider="google" href={calendars.google} isExternal>
                      {strings.google}
                    </ButtonLink>
                    <ButtonLink provider="outlook" href={calendars.outlook} isExternal>
                      {strings.outlook}
                    </ButtonLink>
                    <ButtonLink provider="apple-calendar" href={calendars.ics} download="booking.ics">
                      {strings.apple}
                    </ButtonLink>
                  </div>
                </div>
              )}
            </section>
          )}
          {isLive && changes}
          {!isLive && again !== undefined && (
            <p className={styles.again}>
              <span>{state === 'cancelled' ? strings.cancelledNext : strings.pastNext}</span>
              <Link href={again.href}>{again.label}</Link>
            </p>
          )}
        </article>
        {brand === undefined ? (
          <BookingFoot page={isWelcome ? 'booking_confirmation' : 'booking_manage'} />
        ) : (
          <footer className={styles.foot}>
            <a
              className={styles.brand}
              href={brand.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={brand.label}
            >
              <img
                className={styles.wordmark}
                data-scheme="light"
                src={(brand.logo ?? TIMEFIX_LOGO).light}
                alt={strings.product}
              />
              <img
                className={styles.wordmark}
                data-scheme="dark"
                src={(brand.logo ?? TIMEFIX_LOGO).dark}
                alt={strings.product}
              />
            </a>
          </footer>
        )}
      </div>
    </main>
  );
}
