import { useId, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Link } from '../../atoms/Link/Link.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import styles from './MeetingCard.module.css';
import { strings } from './strings.ts';

/** Someone in the meeting: the guest, a colleague who hosts it, another invitee. */
export interface MeetingCardPerson {
  readonly id: string;
  readonly name: string;
  /** Their person page; the name links there. */
  readonly href?: string;
  /** Under the name, muted: their email, or their part ("Host"). */
  readonly detail?: string;
  /** Puts a copy button after `detail` (an email the host may paste elsewhere). */
  readonly isDetailCopyable?: boolean;
}

/** One fact about the meeting, beside its icon: where, a note, how it was booked. */
export interface MeetingCardRow {
  readonly id: string;
  readonly icon: IconName;
  /** What the row is, read before it ("Where"); the icon stands for it on screen. */
  readonly label: string;
  /** The fact, in the text colour ("Google Meet"). */
  readonly value: ReactNode;
  /** A quieter line under it. */
  readonly detail?: ReactNode;
  /** A quiet control at the row's end ("View chat"). */
  readonly action?: ReactNode;
  /** More under the row, in its text column (the chat a "View chat" opens). */
  readonly children?: ReactNode;
}

/** Props for MeetingCard. */
export interface MeetingCardProps {
  /** What the meeting is, the card's heading ("Grace Hopper · Intro call"). */
  readonly title: string;
  /** When, under the title ("Friday, October 23 · 9:00 – 9:30 AM"). */
  readonly when: string;
  /** Where it stands, a quiet dot and word beside the time ("Confirmed", "Canceled"). */
  readonly status?: { readonly label: string; readonly hue: Hue };
  /** Callouts that need reading first (the calendar event couldn't be made, it needs a host). */
  readonly notices?: ReactNode;
  /** Who is in it: the first under the heading, each with an avatar. */
  readonly people?: readonly MeetingCardPerson[];
  /** What the people row is called for screen readers. Default "Guests". */
  readonly peopleLabel?: string;
  readonly rows?: readonly MeetingCardRow[];
  /** The footer's actions, primary first (Join, Reschedule, Copy guest link). */
  readonly actions?: ReactNode;
  /** The footer's far end: a quiet ending action (Cancel booking), apart from the rest. */
  readonly endAction?: ReactNode;
  /** The heading's level where the card sits. Default 2 (a popover or sheet of its own). */
  readonly headingLevel?: 2 | 3;
}

/**
 * One meeting's details, as Google Calendar's and Calendly's cards lay them out: a title and its time first,
 * the status a quiet dot beside the time; then icon rows (who, where, notes) on one rhythm; then the actions in a
 * footer, primary first and an ending one apart at the end. It has no surface of its own: the Popover beside a
 * week's block, a Panel or a sheet holds it.
 */
export function MeetingCard({
  title,
  when,
  status,
  notices,
  people = [],
  peopleLabel = strings.people,
  rows = [],
  actions,
  endAction,
  headingLevel = 2,
}: MeetingCardProps) {
  const id = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className={styles.root} aria-labelledby={`${id}-title`}>
      <header className={styles.head}>
        <Heading id={`${id}-title`} className={styles.title}>
          {title}
        </Heading>
        <p className={styles.when}>
          <span>{when}</span>
          {status !== undefined && <StatusDot hue={status.hue}>{status.label}</StatusDot>}
        </p>
      </header>
      {notices}
      {(people.length > 0 || rows.length > 0) && (
        <dl className={styles.rows}>
          {people.length > 0 && (
            <div className={styles.row}>
              <dt className={styles.icon}>
                <Icon name={people.length > 1 ? 'users' : 'user'} size="sm" />
                <VisuallyHidden>{peopleLabel}</VisuallyHidden>
              </dt>
              <dd className={styles.content}>
                <ul className={styles.people}>
                  {people.map((person) => (
                    <li key={person.id} className={styles.person}>
                      <Avatar name={person.name} id={person.id} size="sm" isDecorative />
                      <span className={styles.personText}>
                        <span className={styles.value}>
                          {person.href === undefined ? person.name : <Link href={person.href}>{person.name}</Link>}
                        </span>
                        {person.detail !== undefined && (
                          <span className={styles.detailLine}>
                            <span className={styles.detail}>{person.detail}</span>
                            {person.isDetailCopyable === true && (
                              <CopyButton
                                value={person.detail}
                                label={strings.copy(person.detail)}
                                isIconOnly
                                variant="ghost"
                                size="sm"
                              />
                            )}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {rows.map((row) => (
            <div key={row.id} className={styles.row}>
              <dt className={styles.icon}>
                <Icon name={row.icon} size="sm" />
                <VisuallyHidden>{row.label}</VisuallyHidden>
              </dt>
              <dd className={styles.content}>
                <span className={styles.line}>
                  <span className={styles.lineText}>
                    <span className={styles.value}>{row.value}</span>
                    {row.detail !== undefined && <span className={styles.detail}>{row.detail}</span>}
                  </span>
                  {row.action}
                </span>
                {row.children}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {(actions !== undefined || endAction !== undefined) && (
        <footer className={styles.foot}>
          <div className={styles.actions}>{actions}</div>
          {endAction}
        </footer>
      )}
    </article>
  );
}
