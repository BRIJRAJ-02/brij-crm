// PresenceGroup (spec 0073, AC-7308): the prototype's Presence group, as a thin wrapper beside AvatarStack. It is a
// file of its own with its own stylesheet because AvatarStack is in the booking page's first load, whose CSS budget
// has no room, and a status dot, a tooltip per person and the hover lift are app only.
import { useRef } from 'react';
import { useFocusable } from 'react-aria';
import type { Hue } from '../../hue.ts';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { Avatar } from './Avatar.tsx';
import styles from './PresenceGroup.module.css';
import { presenceStrings as strings } from './presence-strings.ts';

/** One person looking at the same thing now. */
export interface PresencePerson {
  readonly id: string;
  readonly name: string;
  readonly src?: string;
  readonly hue?: Hue;
  /** `active` (a green dot) is here now; `idle` (amber) has it open in the background. */
  readonly status: 'active' | 'idle';
  /** What they are doing, for their tooltip: "Editing Discovery call". */
  readonly activity?: string;
}

/** Props for PresenceGroup. */
export interface PresenceGroupProps {
  /**
   * Who is here, in the order to draw them: the screen puts active people first, then the most recent. Hand it only
   * people the viewer may see (the access door's answer); it draws what it is given.
   */
  readonly people: readonly PresencePerson[];
  /** How many avatars before "+n" (4 by default). However many are here, no more are drawn or named. */
  readonly max?: number;
  readonly size?: 'sm' | 'md';
}

/** One avatar: a tab stop that names the person, with their status dot and a tooltip saying what they are doing. */
function PresenceItem({ person, size }: { readonly person: PresencePerson; readonly size: 'sm' | 'md' }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { focusableProps } = useFocusable({}, ref);
  return (
    <span
      ref={ref}
      className={styles.item}
      role="img"
      aria-label={person.name}
      // A tooltip's trigger must be reachable by keyboard (WCAG 1.4.13): the avatar is a tab stop so its tooltip,
      // what the person is doing, can be read without a pointer.
      // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
      tabIndex={0}
      data-status={person.status}
      {...focusableProps}
    >
      <Avatar
        id={person.id}
        name={person.name}
        size={size}
        isDecorative
        {...(person.src === undefined ? {} : { src: person.src })}
        {...(person.hue === undefined ? {} : { hue: person.hue })}
      />
      <span className={styles.dot} aria-hidden="true" />
    </span>
  );
}

/**
 * Who else is here: overlapping avatars with a live status dot each, named in a tooltip, then "+n". Each avatar is a
 * tab stop; the hovered or focused one lifts a little and its neighbours less. It draws at most `max` people however
 * many are here, and its name says at most `max` names, so a crowd of a thousand costs what four do.
 */
export function PresenceGroup({ people, max = 4, size = 'sm' }: PresenceGroupProps) {
  const shown = people.slice(0, Math.max(0, max));
  const rest = people.length - shown.length;
  return (
    <span
      className={styles.root}
      data-size={size}
      role="group"
      aria-label={strings.group(
        people.length,
        shown.map((person) => person.name),
        rest,
      )}
    >
      {shown.map((person) => (
        <Tooltip
          key={person.id}
          placement="bottom"
          content={strings.tooltip(
            person.name,
            person.activity ?? (person.status === 'active' ? strings.hereNow : strings.away),
          )}
        >
          <PresenceItem person={person} size={size} />
        </Tooltip>
      ))}
      {rest > 0 && (
        <span className={styles.more} aria-hidden="true">
          {strings.more(rest)}
        </span>
      )}
    </span>
  );
}
