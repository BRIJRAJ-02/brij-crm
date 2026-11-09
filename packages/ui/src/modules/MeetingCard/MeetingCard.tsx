import { Fragment, useId, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Link } from '../../atoms/Link/Link.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
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

/** A titled group of the card's people and facts (Guest, Location, Answers, History). */
export interface MeetingCardSection {
  readonly id: string;
  /** The group's heading in a panel ("Guest"); in a popover the group runs on unlabelled, as one card. */
  readonly label: string;
  readonly people?: readonly MeetingCardPerson[];
  readonly rows?: readonly MeetingCardRow[];
  /**
   * `popup` only: `folded` puts the group in a Disclosure under its label, closed (Answers, History), with `count`
   * after the label; `plain` runs it on unlabelled (the facts at the top). Absent, it opens on its label.
   */
  readonly display?: 'plain' | 'folded';
  /** `popup` only: a folded group's count after its label (Answers 2). */
  readonly count?: number;
}

/** Props for MeetingCard. */
export interface MeetingCardProps {
  /** What the meeting is, the card's heading ("Grace Hopper · Intro call"). */
  readonly title: string;
  /** When, under the title ("Friday, October 23 · 9:00 – 9:30 AM"). */
  readonly when: string;
  /** Where it stands, a quiet dot and word beside the time ("Confirmed", "Cancelled"). */
  readonly status?: { readonly label: string; readonly hue: Hue };
  /** Callouts that need reading first (the calendar event couldn't be made, it needs a host). */
  readonly notices?: ReactNode;
  /** Who is in it: the first under the heading, each with an avatar. */
  readonly people?: readonly MeetingCardPerson[];
  /** What the people row is called for screen readers. Default "Guests". */
  readonly peopleLabel?: string;
  readonly rows?: readonly MeetingCardRow[];
  /**
   * The footer's actions on one row, primary first: at most Join, one more and an overflow menu (Reschedule, then
   * More holding Copy guest link and Cancel booking), each `size="lg"`.
   */
  readonly actions?: ReactNode;
  /** The footer's far end: a quiet ending action (Cancel booking), apart from the rest, `size="lg"` too. */
  readonly endAction?: ReactNode;
  /**
   * The heading's level where the card sits. Default 2; under a dialog's own heading (a Panel's or a sheet's,
   * level 3) pass 4, beside one with none (a popover) 3.
   */
  readonly headingLevel?: 2 | 3 | 4;
  /**
   * After `people` and `rows`: titled groups of them. In a `panel` each has its heading; in a `popover` they run on
   * as the card's rows, unlabelled.
   */
  readonly sections?: readonly MeetingCardSection[];
  /**
   * `popover` (the default): the week's card, its title on the text column beside the gutter and the actions in a
   * footer. `panel` (a side panel, after Calendly's): the title and each section's heading start at the panel's own
   * edge, under its heading, and the actions sit right under the title, where they are seen first.
   * `popup` (the meeting popup, the Bookings redesign of 9 November 2026) sits in a Modal whose title bar names the
   * meeting and holds its status and ⋯: no heading or actions of its own, `when` as the first fact beside a clock, and
   * the sections as the popup's groups, labelled, plain or folded (`display`).
   */
  readonly variant?: 'popover' | 'panel' | 'popup';
}

/** One person a row: their avatar in the gutter, their name (a link with `href`) and a quieter detail. */
function PeopleList({ people, label }: { readonly people: readonly MeetingCardPerson[]; readonly label: string }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {people.map((person) => (
        <li key={person.id} className={styles.row}>
          <span className={styles.lead}>
            <Avatar name={person.name} id={person.id} size="md" isDecorative />
          </span>
          <span className={styles.content}>
            <span className={styles.value}>
              {person.href === undefined ? person.name : <Link href={person.href}>{person.name}</Link>}
            </span>
            {person.detail !== undefined && (
              <span className={styles.detailLine}>
                <span className={styles.detail}>{person.detail}</span>
                {person.isDetailCopyable === true && (
                  <span className={styles.copy}>
                    <Tooltip content={strings.copy(person.detail)}>
                      <CopyButton
                        value={person.detail}
                        label={strings.copy(person.detail)}
                        isIconOnly
                        variant="ghost"
                      />
                    </Tooltip>
                  </span>
                )}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The facts, a real `<dl>`: each row's icon in the gutter (its label read in its place), the value and its action. */
function RowList({ rows }: { readonly rows: readonly MeetingCardRow[] }) {
  return (
    <dl className={styles.list}>
      {rows.map((row) => (
        <div key={row.id} className={styles.row}>
          <dt className={styles.lead}>
            <Icon name={row.icon} />
            <VisuallyHidden>{row.label}</VisuallyHidden>
          </dt>
          <dd className={styles.content}>
            <span className={styles.line}>
              <span className={styles.lineText}>
                <span className={styles.value}>{row.value}</span>
                {row.detail !== undefined && <span className={styles.detail}>{row.detail}</span>}
              </span>
              {row.action !== undefined && <span className={styles.rowAction}>{row.action}</span>}
            </span>
            {row.children}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One meeting's details, as Google Calendar's card lays them out: every line of text starts on one text column,
 * with a gutter to its left holding each row's icon or avatar, centred on the row's first line. The title and its
 * time first, the status a quiet dot beside the time; then the people (an avatar each) and the facts (an icon
 * each), all on one rhythm; then the actions in a footer, primary first and an ending one apart at the end. It has
 * no surface of its own: the Popover beside a week's block, a Panel or a sheet holds it.
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
  sections = [],
  variant = 'popover',
}: MeetingCardProps) {
  const id = useId();
  const Heading = headingLevel === 2 ? 'h2' : headingLevel === 3 ? 'h3' : 'h4';
  const SectionHeading = headingLevel === 2 ? 'h3' : headingLevel === 3 ? 'h4' : 'h5';
  const isPanel = variant === 'panel';
  if (variant === 'popup') {
    return (
      <article className={styles.root} aria-label={title} data-variant={variant}>
        {notices !== undefined && <div className={styles.notices}>{notices}</div>}
        <RowList rows={[{ id: 'when', icon: 'clock', label: strings.when, value: when }, ...rows]} />
        {people.length > 0 && <PeopleList people={people} label={peopleLabel} />}
        {sections.map((section) => {
          const lists = (
            <>
              {section.people !== undefined && section.people.length > 0 && (
                <PeopleList people={section.people} label={section.label} />
              )}
              {section.rows !== undefined && section.rows.length > 0 && <RowList rows={section.rows} />}
            </>
          );
          if (section.display === 'plain') return <Fragment key={section.id}>{lists}</Fragment>;
          if (section.display === 'folded') {
            return (
              <div key={section.id} className={styles.fold}>
                <Disclosure
                  title={section.label}
                  {...(section.count === undefined ? {} : { count: section.count })}
                  headingLevel={headingLevel === 4 ? 5 : headingLevel === 3 ? 4 : 3}
                >
                  <div className={styles.folded}>{lists}</div>
                </Disclosure>
              </div>
            );
          }
          return (
            <section key={section.id} className={styles.group} aria-labelledby={`${id}-${section.id}`}>
              <SectionHeading id={`${id}-${section.id}`} className={styles.sectionLabel}>
                {section.label}
              </SectionHeading>
              {lists}
            </section>
          );
        })}
      </article>
    );
  }
  const hasActions = actions !== undefined || endAction !== undefined;
  const actionBar = hasActions ? (
    <footer className={styles.foot}>
      <div className={styles.actions}>{actions}</div>
      {endAction}
    </footer>
  ) : undefined;
  return (
    <article className={styles.root} aria-labelledby={`${id}-title`} data-variant={isPanel ? variant : undefined}>
      <header className={styles.inset}>
        <Heading id={`${id}-title`} className={styles.title}>
          {title}
        </Heading>
        <p className={styles.when}>
          <span>{when}</span>
          {status !== undefined && <StatusDot hue={status.hue}>{status.label}</StatusDot>}
        </p>
      </header>
      {isPanel && actionBar}
      {notices !== undefined && <div className={styles.inset}>{notices}</div>}
      {people.length > 0 && <PeopleList people={people} label={peopleLabel} />}
      {rows.length > 0 && <RowList rows={rows} />}
      {sections.map((section) => {
        const lists = (
          <>
            {section.people !== undefined && section.people.length > 0 && (
              <PeopleList people={section.people} label={section.label} />
            )}
            {section.rows !== undefined && section.rows.length > 0 && <RowList rows={section.rows} />}
          </>
        );
        return isPanel ? (
          <section key={section.id} className={styles.section} aria-labelledby={`${id}-${section.id}`}>
            <SectionHeading id={`${id}-${section.id}`} className={styles.sectionLabel}>
              {section.label}
            </SectionHeading>
            {lists}
          </section>
        ) : (
          <Fragment key={section.id}>{lists}</Fragment>
        );
      })}
      {!isPanel && actionBar}
    </article>
  );
}
