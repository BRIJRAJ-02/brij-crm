import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import styles from './GuestChips.module.css';

/** Props for GuestChips. */
export interface GuestChipsProps {
  /** The guests' email addresses, in the order they were added. */
  readonly guests: readonly string[];
  /** The list's name ("Guests to invite"). */
  readonly label: string;
  /** Each chip's remove button's name ("Remove ada@example.com"). */
  readonly removeLabel: (guest: string) => string;
  /** Removes the guest at this place in the list. Leave it off where guests can't be removed (read only). */
  readonly onRemove?: (index: number) => void;
  /** The places of guests a server turned down: their chips take the danger edge, the field's error says why. */
  readonly invalid?: ReadonlySet<number>;
}

/**
 * Guests as chips (the owner, 1 and 2 November 2026): each address with its initial and a remove button, the one
 * look for adding and removing guests wherever a booking takes them, the booking form and a guest's manage page
 * alike. A chip arrives out of a soft blur. Draws nothing with no guests.
 */
export function GuestChips({ guests, label, removeLabel, onRemove, invalid }: GuestChipsProps) {
  if (guests.length === 0) return null;
  return (
    <ul className={styles.root} aria-label={label}>
      {guests.map((guest, index) => (
        <li
          key={guest}
          className={styles.chip}
          data-invalid={invalid?.has(index) === true ? '' : undefined}
          data-removable={onRemove === undefined ? undefined : ''}
        >
          <Avatar name={guest} size="xs" isDecorative />
          <span className={styles.text}>{guest}</span>
          {onRemove !== undefined && (
            <Button variant="ghost" size="sm" icon="x" label={removeLabel(guest)} onPress={() => onRemove(index)} />
          )}
        </li>
      ))}
    </ul>
  );
}
