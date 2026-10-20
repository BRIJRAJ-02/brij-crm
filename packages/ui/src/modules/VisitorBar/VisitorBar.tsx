import { useRef } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
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
  /** "Not you?": forget who this is for the visit. Focus moves to the tag's next state. */
  readonly onNotYou?: () => void;
  /** While the page asks who the visitor is: the tag's space held, so nothing jumps when it fills. */
  readonly isLoading?: boolean;
}

/** What the tag says after the visitor's name. */
function stateLabel(calendar: VisitorBarCalendar, showAll: boolean): string | undefined {
  switch (calendar) {
    case 'on':
      return showAll ? strings.tagAll : strings.tagBothFree;
    case 'unreachable':
      return strings.tagUnreachable;
    case 'needs-reconnect':
      return strings.tagReconnect;
    case 'none':
      return undefined;
  }
}

/** The sentence a screen reader hears as the state changes. */
function headline(calendar: VisitorBarCalendar, showAll: boolean, name: string): string {
  switch (calendar) {
    case 'on':
      return showAll ? strings.showingAll : strings.bothFree;
    case 'unreachable':
      return strings.unreachable;
    case 'needs-reconnect':
      return strings.reconnect;
    case 'none':
      return strings.bookingAs(name);
  }
}

/**
 * The visitor's tag on top of a booking page (spec 0028, AC-720 to AC-726),
 * small, at the end of the row above the card. A visitor we don't know gets
 * Connect calendar (Google's mark; what it reads in its tooltip). A visitor we
 * know gets their name and their calendar's state, opening a menu with who
 * they're booking as, Show all times, Connect again and Not you.
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
  const root = useRef<HTMLDivElement>(null);
  if (isLoading) {
    return (
      <div className={styles.root} aria-busy="true">
        <span className={styles.placeholder}>
          <Skeleton width="short" />
        </span>
      </div>
    );
  }
  if (person === undefined) {
    if (connectHref === undefined) return null;
    return (
      <div ref={root} className={styles.root} tabIndex={-1}>
        <VisuallyHidden>{strings.invite}</VisuallyHidden>
        <Tooltip content={strings.readsOnly}>
          <ButtonLink href={connectHref} provider="google">
            {strings.connect}
          </ButtonLink>
        </Tooltip>
      </div>
    );
  }
  const name = person.name === '' ? person.email : person.name;
  const state = stateLabel(calendar, showAll);
  const canConnectAgain = connectHref !== undefined && calendar === 'unreachable';
  const notYou = () => {
    onNotYou?.();
    // The tag changes with the person: focus Connect calendar, or the tag's place.
    focusLater(() => root.current?.querySelector<HTMLElement>('a[href]') ?? root.current);
  };
  return (
    <div ref={root} className={styles.root} tabIndex={-1}>
      {/* Only the state is live: turning Show all times on says what changed, not who you are again. */}
      <VisuallyHidden>
        <span role="status">{headline(calendar, showAll, name)}</span>
      </VisuallyHidden>
      <MenuTrigger>
        <Button icon={calendar === 'on' ? 'calendar-check' : 'calendar-days'} iconRight="chevron-down">
          {state === undefined ? name : strings.tag(name, state)}
        </Button>
        <Menu label={strings.label} placement="bottom end">
          <MenuItem
            id="who"
            leading={<Avatar name={name} size="sm" isDecorative />}
            description={person.email}
            isDisabled
          >
            {strings.bookingAs(name)}
          </MenuItem>
          <MenuSeparator />
          {calendar === 'on' && onShowAllChange !== undefined ? (
            <MenuItem id="all" icon="calendar-days" isChecked={showAll} onAction={() => onShowAllChange(!showAll)}>
              {strings.showAll}
            </MenuItem>
          ) : null}
          {canConnectAgain ? (
            <MenuItem id="again" icon="refresh-cw" href={connectHref}>
              {strings.connectAgain}
            </MenuItem>
          ) : null}
          {onNotYou === undefined ? null : (
            <MenuItem id="not-you" icon="user-x" onAction={notYou}>
              {strings.notYou}
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
    </div>
  );
}
