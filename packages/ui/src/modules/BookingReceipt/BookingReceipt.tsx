import { useEffect, useId, useRef, type ReactNode } from 'react';
import { DialogTrigger } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import type { ProductLogo } from '../AuthLayout/AuthLayout.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import { ProviderMark } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { SuccessCheck } from '../../atoms/SuccessCheck/SuccessCheck.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { DescriptionList, type DescriptionItem } from '../../molecules/DescriptionList/DescriptionList.tsx';
import { BookingFoot } from '../BookingFrame/BookingFrame.tsx';
import styles from './BookingReceipt.module.css';
import { strings } from './strings.ts';

/**
 * Where a booking stands. `requested` waits for its host's Confirm, and `declined` is one the host (or the wait)
 * turned down (spec 0062, AC-6203).
 */
export type BookingReceiptState = 'confirmed' | 'requested' | 'declined' | 'cancelled' | 'past';

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
  /**
   * The summary at the card's head (spec 0058, AC-19): what the meeting is ("Intro call") and who it is with
   * ("with Ada Lovelace"), over the time. Left out, the card opens on the time alone.
   */
  readonly summary?: { readonly what: string; readonly who: string };
  /** The details under the summary: Who in full, guests, Where and the note. */
  readonly facts: readonly DescriptionItem[];
  /** The call's address, once it has one: Join the call. */
  readonly joinUrl?: string;
  /**
   * Add to calendar: Google, Outlook, and an .ics file: its address, or what fetches and saves it when pressed (a
   * table reservation's file comes by POST with the guest's key, spec 0066 B7, never by an address holding it).
   */
  readonly calendars?: {
    readonly google: string;
    readonly outlook: string;
    readonly ics: string | (() => void);
  };
  /**
   * Share this meeting (the owner, 2 November 2026): the details anyone can be sent (what, when, where, the call's
   * link) and a link that adds it to their own calendar. Never the visitor's note, and never this page's link, which
   * would let whoever has it move or cancel.
   */
  readonly share?: { readonly title: string; readonly lines: readonly string[]; readonly calendarUrl: string };
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
  /**
   * `page` (the default): the guest's own page, `/b/<key>/manage`, with its ground and foot. `card`: the booking
   * page's last step, drawn inside its BookingFrame card right after Confirm (critic C1, 4 November 2026), so booking
   * never swaps the page for another: no ground, no card of its own and no foot, which the frame already has.
   */
  readonly placement?: 'page' | 'card';
  /**
   * The booked moment's card (the v5 mock, 9 November 2026): the whole time as the card's first line ("Monday 9
   * November, 11:30 am – 12:00 pm"), the zone and how soon quietly under it ("London time (GMT) · in 4 hours"), the
   * details as What, Who and Where, Join the call across the card, and Add to calendar and Share as quiet actions.
   * Right after booking a check lands over the heading. Left out, the card leads with the date chip, as before.
   */
  readonly headline?: { readonly when: string; readonly meta: string };
  /** Right after booking: where the details went, said under the heading ("We sent the details to ann@…"). */
  readonly sentTo?: string;
  /**
   * The heading in place of the state's own, for a state the page knows more about: a long ended booking's link
   * ("This booking ended", B-13), whose guest details are no longer kept.
   */
  readonly heading?: string;
}

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
  summary,
  facts,
  joinUrl,
  calendars,
  share,
  again,
  changes,
  notice,
  brand,
  placement = 'page',
  heading: headingText,
  headline,
  sentTo,
}: BookingReceiptProps) {
  const isPlain = headline !== undefined;
  const isInCard = placement === 'card';
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  // In the booking page's card the frame is the page's `main` and its `h1`: the receipt is a section under it.
  const Root = isInCard ? 'section' : 'main';
  const Heading = isInCard ? 'h2' : 'h1';
  // The heading takes focus as the page arrives, and again when the booking's state changes (cancelled from here).
  useEffect(() => heading.current?.focus(), [state]);
  const isLive = state === 'confirmed';
  // A request is still ahead and still the guest's to cancel, but has no call or calendar entry until it is confirmed.
  const isAhead = isLive || state === 'requested';
  const title =
    state === 'cancelled'
      ? strings.cancelled
      : state === 'declined'
        ? strings.declined
        : state === 'past'
          ? strings.past
          : state === 'requested'
            ? isWelcome
              ? strings.requestSent
              : strings.requested
            : isWelcome
              ? strings.welcome
              : strings.confirmed;
  return (
    <Root
      className={styles.root}
      data-placement={placement}
      data-welcome={(isLive && isWelcome) || undefined}
      {...(isInCard ? { 'aria-labelledby': titleId } : {})}
    >
      <div className={styles.column}>
        <header className={styles.head} data-plain={isPlain || undefined}>
          {isPlain ? (
            <HeadMark state={state} isWelcome={isWelcome} />
          ) : (
            <span className={styles.avatar}>
              <Avatar name={hostName} size="lg" isDecorative {...(hostImage === undefined ? {} : { src: hostImage })} />
              <span
                className={styles.mark}
                data-state={state}
                data-welcome={(isLive && isWelcome) || undefined}
                aria-hidden="true"
              >
                <Icon
                  name={state === 'confirmed' ? 'check' : state === 'cancelled' || state === 'declined' ? 'x' : 'clock'}
                  size="xs"
                />
              </span>
            </span>
          )}
          <Heading ref={heading} id={titleId} tabIndex={-1} className={styles.title}>
            {headingText ?? title}
          </Heading>
          {/* One warm line, right after booking only: the page is a confirmation, not a form (AC-21). */}
          {isLive && (isWelcome || isPlain) && <p className={styles.lead}>{strings.welcomeLine(hostName)}</p>}
          {isLive && isWelcome && sentTo !== undefined && (
            <p className={styles.sent}>
              <span className={styles.sentIcon}>
                <Icon name="mail" size="sm" tone="muted" />
              </span>
              {strings.sentTo(sentTo)}
            </p>
          )}
          {state === 'requested' && <p className={styles.lead}>{strings.requestedLine(hostName)}</p>}
        </header>
        {notice}
        <article className={styles.card} aria-label={strings.marks[state]}>
          {isPlain ? (
            <>
              <div className={styles.top} data-state={state}>
                <p className={styles.headline}>{headline.when}</p>
                <p className={styles.meta}>{headline.meta}</p>
              </div>
              {facts.length > 0 && (
                <div className={styles.kvs}>
                  <DescriptionList items={facts} />
                </div>
              )}
              {isLive && (joinUrl !== undefined || calendars !== undefined || share !== undefined) && (
                <div className={styles.go}>
                  {joinUrl !== undefined && (
                    <ButtonLink variant="primary" size="lg" icon="video" href={joinUrl} isExternal isFullWidth="center">
                      {strings.join}
                    </ButtonLink>
                  )}
                  <div className={styles.quiet}>
                    {calendars !== undefined && <AddToCalendar calendars={calendars} />}
                    {share !== undefined && <ShareMeeting share={share} />}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* The summary leads (AC-19): what, when and who in one band, then the one thing to do with it. */}
              <div className={styles.band} data-state={state}>
                <div className={styles.chip} data-live={isLive ? '' : undefined} aria-hidden="true">
                  <span className={styles.chipWeekday}>{date.weekday}</span>
                  <span className={styles.chipDay}>{date.day}</span>
                  <span className={styles.chipMonth}>{date.month}</span>
                </div>
                <div className={styles.when}>
                  {summary !== undefined && (
                    <p className={styles.what}>
                      <span>{summary.what}</span>
                      <span className={styles.who}>{summary.who}</span>
                    </p>
                  )}
                  <p className={styles.range}>{range}</p>
                  <p className={styles.muted}>{when}</p>
                  {isLive && relative !== undefined && <p className={styles.relative}>{relative}</p>}
                </div>
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
                        {typeof calendars.ics === 'string' ? (
                          <ButtonLink provider="apple-calendar" href={calendars.ics} download="invite.ics">
                            {strings.apple}
                          </ButtonLink>
                        ) : (
                          <Button provider="apple-calendar" onPress={calendars.ics}>
                            {strings.apple}
                          </Button>
                        )}
                        {share !== undefined && (
                          <span className={styles.shareAt}>
                            <ShareMeeting share={share} />
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}
              {facts.length > 0 && (
                <div className={styles.facts}>
                  <DescriptionList items={facts} />
                </div>
              )}
            </>
          )}
          {isAhead && changes}
          {!isAhead && again !== undefined && (
            <p className={styles.again}>
              <span>{state === 'past' ? strings.pastNext : strings.cancelledNext}</span>
              <Link href={again.href}>{again.label}</Link>
            </p>
          )}
        </article>
        {/* Every public page ends the same way (spec 0058, AC-26): "Powered by Timefix", quiet and centred. In the
            booking page's card the frame's own foot says it. */}
        {!isInCard && (
          <BookingFoot
            page={isWelcome ? 'booking_confirmation' : 'booking_manage'}
            {...(brand === undefined
              ? {}
              : {
                  href: brand.href,
                  newTabLabel: brand.label,
                  ...(brand.logo === undefined ? {} : { logo: brand.logo }),
                })}
          />
        )}
      </div>
    </Root>
  );
}

/**
 * Over the heading in the booked moment's look: right after booking the check lands (SuccessCheck's `xl`); a cancelled,
 * declined, passed or waiting booking shows its state's quiet mark; a booking opened again later shows none.
 */
function HeadMark({ state, isWelcome }: { readonly state: BookingReceiptState; readonly isWelcome: boolean }) {
  if (state === 'confirmed')
    return isWelcome ? (
      <span className={styles.headMark}>
        <SuccessCheck size="xl" />
      </span>
    ) : null;
  return (
    <span className={`${styles.headMark ?? ''} ${styles.stateMark ?? ''}`} data-state={state} aria-hidden="true">
      <Icon
        name={state === 'cancelled' || state === 'declined' ? 'circle-x' : state === 'past' ? 'circle-check' : 'clock'}
        tone="muted"
      />
    </span>
  );
}

/** Add to calendar, quiet (the v5 mock): one ghost button opening Google Calendar, Outlook and Apple Calendar (.ics). */
function AddToCalendar({ calendars }: { readonly calendars: NonNullable<BookingReceiptProps['calendars']> }) {
  return (
    <MenuTrigger>
      <Button variant="ghost" icon="calendar-plus" iconRight="chevron-down">
        {strings.addToCalendar}
      </Button>
      <Menu label={strings.addToCalendar} placement="bottom">
        <MenuItem
          id="google"
          leading={<ProviderMark provider="google-calendar" size="sm" />}
          href={calendars.google}
          isExternal
        >
          {strings.googleCalendar}
        </MenuItem>
        <MenuItem
          id="outlook"
          leading={<ProviderMark provider="outlook" size="sm" />}
          href={calendars.outlook}
          isExternal
        >
          {strings.outlook}
        </MenuItem>
        {typeof calendars.ics === 'string' ? (
          <MenuItem id="ics" icon="download" href={calendars.ics}>
            {strings.appleIcs}
          </MenuItem>
        ) : (
          <MenuItem id="ics" icon="download" onAction={calendars.ics}>
            {strings.appleIcs}
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}

/**
 * Share: one quiet button at the end of Add to calendar, opening a small popover (stageshow's share): the meeting in
 * two lines as it will be sent, then Copy details, and the device's own share sheet where it has one (a phone). What
 * is sent carries a link that puts the meeting in the receiver's calendar.
 */
function ShareMeeting({ share }: { readonly share: NonNullable<BookingReceiptProps['share']> }) {
  const [first, ...rest] = share.lines;
  const message = [...share.lines, strings.addLine(share.calendarUrl)].join('\n');
  // The device's share sheet, where there is one; everywhere else Copy details does the job alone.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <DialogTrigger>
      <Button variant="ghost" icon="share">
        {strings.share}
      </Button>
      <Popover label={strings.shareHeading} placement="bottom end">
        <div className={styles.sharePanel}>
          <p className={styles.shareTitle}>{first}</p>
          <p className={styles.shareLines}>{rest.join(' · ')}</p>
          <div className={styles.shareActions}>
            <CopyButton value={message} label={strings.copyDetails} announcement={strings.copiedDetails} />
            {canShare && (
              <Button
                variant="primary"
                icon="share"
                onPress={() => {
                  // A dismissed sheet rejects; nothing to say about that.
                  navigator
                    .share({ title: share.title, text: share.lines.join('\n'), url: share.calendarUrl })
                    .catch(() => undefined);
                }}
              >
                {strings.shareVia}
              </Button>
            )}
          </div>
        </div>
      </Popover>
    </DialogTrigger>
  );
}
