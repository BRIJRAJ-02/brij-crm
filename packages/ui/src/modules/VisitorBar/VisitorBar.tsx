import { useRef } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import styles from './VisitorBar.module.css';
import { strings } from './strings.ts';

/** The visitor the page knows: from their Timefix sign in, or the Google account they connected. */
export interface VisitorBarPerson {
  readonly name: string;
  readonly email: string;
}

/**
 * Their calendar on this page: `on` (laid over the times), `none` (known, no
 * calendar), `unreachable` (couldn't be read just now) or `needs-reconnect`
 * (it refuses us until they reconnect it in Timefix).
 */
export type VisitorBarCalendar = 'on' | 'none' | 'unreachable' | 'needs-reconnect';

/** Props for VisitorBar. */
export interface VisitorBarProps {
  /** Who is booking; leave it off for a visitor we don't know, who is asked to connect. */
  readonly person?: VisitorBarPerson;
  readonly calendar?: VisitorBarCalendar;
  /** Where Connect calendar goes (Google for this visit, then back). Leave it off where nobody may connect. */
  readonly connectHref?: string;
  /** Every time shows, the ones the visitor is busy for marked. */
  readonly showAll?: boolean;
  readonly onShowAllChange?: (showAll: boolean) => void;
  /** "Not you?": forget who this is for the visit. Focus moves to the bar's next state. */
  readonly onNotYou?: () => void;
  /** While the page asks who the visitor is: the bar's space held, so nothing jumps when it fills. */
  readonly isLoading?: boolean;
}

/** The bar's first line, by what the page knows. */
function headline(person: VisitorBarPerson | undefined, calendar: VisitorBarCalendar, showAll: boolean): string {
  if (person === undefined) return strings.invite;
  switch (calendar) {
    case 'on':
      return showAll ? strings.showingAll : strings.bothFree;
    case 'unreachable':
      return strings.unreachable;
    case 'needs-reconnect':
      return strings.reconnect;
    case 'none':
      return strings.bookingAs(person.name === '' ? person.email : person.name);
  }
}

/**
 * The bar on top of a booking page (spec 0028, AC-720 to AC-726): a visitor
 * we don't know is asked to connect their calendar, with what it reads; a
 * visitor we know sees who they're booking as, whether their calendar is
 * laid over the times, Show all times, and Not you.
 */
export function VisitorBar({
  person,
  calendar = 'none',
  connectHref,
  showAll = false,
  onShowAllChange,
  onNotYou,
  isLoading = false,
}: VisitorBarProps) {
  const root = useRef<HTMLElement>(null);
  if (isLoading) {
    return (
      <section className={styles.root} aria-label={strings.label} aria-busy="true">
        <div className={styles.bar}>
          <span className={styles.lead}>
            <Skeleton shape="circle" />
          </span>
          <span className={styles.body}>
            <Skeleton lines={2} width="medium" />
          </span>
        </div>
      </section>
    );
  }
  const title = headline(person, calendar, showAll);
  const detail =
    person === undefined
      ? strings.readsOnly
      : calendar === 'none'
        ? person.email
        : strings.bookingAs(person.name === '' ? person.email : person.name);
  const canConnect = connectHref !== undefined && (person === undefined || calendar === 'unreachable');
  return (
    <section ref={root} className={styles.root} aria-label={strings.label} tabIndex={-1}>
      <div className={styles.bar}>
        <span className={styles.lead}>
          {person === undefined ? (
            <span className={styles.tile}>
              <Icon name="calendar" size="sm" tone="muted" />
            </span>
          ) : (
            <Avatar name={person.name === '' ? person.email : person.name} size="lg" isDecorative />
          )}
        </span>
        <span className={styles.body}>
          {/* Only the headline is live: turning Show all times on says what changed, not who you are again. */}
          <span className={styles.title} role="status">
            {title}
          </span>
          <span className={styles.detail}>{detail}</span>
        </span>
        <span className={styles.actions}>
          {person !== undefined && calendar === 'on' && onShowAllChange !== undefined && (
            <Switch label={strings.showAll} isSelected={showAll} onChange={onShowAllChange} />
          )}
          {canConnect && (
            <ButtonLink href={connectHref} provider="google" variant={person === undefined ? 'secondary' : 'ghost'}>
              {person === undefined ? strings.connect : strings.connectAgain}
            </ButtonLink>
          )}
          {person !== undefined && onNotYou !== undefined && (
            <Button
              variant="ghost"
              onPress={() => {
                onNotYou();
                // The button goes with the person: focus the bar's next control, or the bar itself.
                focusLater(() => root.current?.querySelector<HTMLElement>('a[href]') ?? root.current);
              }}
            >
              {strings.notYou}
            </Button>
          )}
        </span>
      </div>
    </section>
  );
}
