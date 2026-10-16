// The editor references share (members, records): the chosen ones as chips
// you can remove, and a searchable menu that adds or replaces one. Results
// come from the screen through a ListSource, so long lists stay outside.
import type { ActorDisplay, Hue, RecordRefDisplay } from '@crm/contracts/values';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { RecordChip } from '../atoms/RecordChip/RecordChip.tsx';
import { arraySource, type ListSource } from '../lib/list-source.ts';
import type { IconName } from '../atoms/Icon/icons.ts';
import { Menu, MenuTrigger } from '../molecules/Menu/Menu.tsx';
import { Select } from '../molecules/Select/Select.tsx';
import styles from './ReferencePicker.module.css';
import { strings } from './strings.ts';

type Reference = RecordRefDisplay | ActorDisplay;

/** One object a record search can look in (spec 0019's object switcher). */
export interface SearchObject {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly hue?: Hue;
}

/**
 * Which object a record search looks in, for a reference that may hold
 * records of any object (a task's linked records): the objects, the one
 * searched now, and the change.
 */
export interface ObjectSwitcher {
  readonly objects: readonly SearchObject[];
  readonly objectId: string;
  readonly onObjectChange: (objectId: string) => void;
}

/** Props for ReferencePicker. */
export interface ReferencePickerProps<D extends Reference> {
  /** The attribute's name, for the trigger and the menu. */
  readonly name: string;
  /** The chosen references, as display shapes. */
  readonly chosen: readonly D[];
  /** Several may be chosen; a pick adds one. Otherwise a pick replaces the one. */
  readonly allowMultiple: boolean;
  /** Searches outside. Leave it out when only `pinned` can be offered. */
  readonly onSearch?: (query: string) => ListSource<D>;
  /** Offered first, before the results ("Me"). */
  readonly pinned?: readonly D[];
  readonly keyOf: (display: D) => string;
  readonly onChange: (chosen: readonly D[]) => void;
  readonly isCompact: boolean;
  readonly error?: string;
  /** Opens the search at once, starting from `startQuery`: how the grid starts an edit. */
  readonly isOpenAtStart?: boolean;
  readonly startQuery?: string;
  /**
   * Draws the search and its results in place, under the chosen chips: the
   * grid cell's popover is already the panel, so a menu popover over it
   * would be a panel on a panel.
   */
  readonly isInline?: boolean;
  /** The objects the search can look in; a Select before the search picks one (spec 0019). Without it, nothing changes. */
  readonly objects?: readonly SearchObject[];
  /** The object searched now, one of `objects`. */
  readonly objectId?: string;
  readonly onObjectChange?: (objectId: string) => void;
  /**
   * Draws the attribute's name as the picker's visible label (in a form,
   * where nothing else names it); a cell or a panel row names it already.
   */
  readonly showLabel?: boolean;
}

/** Chosen references as removable chips, and a searchable menu to pick one. */
export function ReferencePicker<D extends Reference>({
  name,
  chosen,
  allowMultiple,
  onSearch,
  pinned = [],
  keyOf,
  onChange,
  isCompact,
  error,
  isOpenAtStart = false,
  startQuery,
  isInline = false,
  objects,
  objectId,
  onObjectChange,
  showLabel = false,
}: ReferencePickerProps<D>) {
  const labelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState(startQuery ?? '');
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    if (!isOpenAtStart) return;
    // A frame later, once the popover the grid opened has placed its own focus.
    const frame = requestAnimationFrame(() => {
      setOpen(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isOpenAtStart]);
  const results = onSearch?.(query);
  const offered: ListSource<D> =
    results === undefined
      ? arraySource(pinned, keyOf)
      : {
          count: pinned.length + results.count,
          getItem: (index) => (index < pinned.length ? pinned[index] : results.getItem(index - pinned.length)),
          getKey: keyOf,
          ...(results.onRangeChange === undefined
            ? {}
            : {
                onRangeChange: ({ start, end }) => {
                  results.onRangeChange?.({
                    start: Math.max(0, start - pinned.length),
                    end: Math.max(0, end - pinned.length),
                  });
                },
              }),
        };
  const pick = (key: string | number) => {
    const found = Array.from({ length: offered.count }, (_, index) => offered.getItem(index)).find(
      (item) => item !== undefined && keyOf(item) === String(key),
    );
    if (found === undefined) return;
    // A pointer pick: focus goes back to the trigger at once, not when the closing menu has faded, so a key pressed
    // meanwhile (Escape in a dialog) reaches what it is meant for. A keyboard pick does the same already.
    if (!isInline) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
    if (!allowMultiple) {
      onChange([found]);
      return;
    }
    if (!chosen.some((item) => keyOf(item) === keyOf(found))) onChange([...chosen, found]);
  };
  const isMe = (display: D) => pinned.some((item) => keyOf(item) === keyOf(display));
  const menu = (
    <Menu<D>
      label={name}
      isInline={isInline}
      search={{
        label: strings.search(name),
        onSearch: setQuery,
        ...(startQuery === undefined ? {} : { defaultQuery: startQuery }),
      }}
      source={offered}
      renderItem={(display) => ({
        children: display.name === '' ? strings.unknown : display.name,
        ...(isMe(display) ? { meta: strings.me } : {}),
        // A member's email tells two people with the same name apart.
        ...('email' in display && display.email !== undefined ? { description: display.email } : {}),
      })}
      onAction={pick}
    />
  );
  return (
    <div
      className={styles.root}
      data-compact={(isCompact && !isInline) || undefined}
      data-inline={isInline || undefined}
      {...(showLabel ? { role: 'group', 'aria-labelledby': labelId } : {})}
    >
      {showLabel && (
        <span id={labelId} className={styles.label}>
          {name}
        </span>
      )}
      {chosen.length > 0 && (
        <ul className={styles.chosen} aria-label={name}>
          {chosen.map((display) => (
            <li key={keyOf(display)} className={styles.item}>
              <RecordChip display={display} />
              <Button
                variant="ghost"
                icon="x"
                label={strings.remove(display.name === '' ? name : display.name)}
                onPress={() => {
                  onChange(chosen.filter((item) => keyOf(item) !== keyOf(display)));
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {objects !== undefined && objects.length > 0 && onObjectChange !== undefined && (
        <Select
          label={strings.searchIn}
          size="sm"
          items={objects.map((object) => ({
            id: object.id,
            label: object.label,
            ...(object.icon === undefined ? {} : { icon: object.icon }),
            ...(object.hue === undefined ? {} : { hue: object.hue }),
          }))}
          value={objectId ?? objects[0]?.id ?? null}
          onChange={(id) => {
            if (id !== null) onObjectChange(id);
          }}
        />
      )}
      {isInline ? (
        menu
      ) : (
        <MenuTrigger isOpen={isOpen} onOpenChange={setOpen}>
          <Button variant={chosen.length === 0 ? 'secondary' : 'ghost'} icon="plus" ref={triggerRef}>
            {chosen.length === 0 || !allowMultiple ? strings.choose(name) : strings.addAnother}
          </Button>
          {menu}
        </MenuTrigger>
      )}
      {error !== undefined && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
