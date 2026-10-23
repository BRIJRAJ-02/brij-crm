// The editor references share (members, records): one field, drawn like
// Field's box, holding the chosen ones as chips you can remove, whose button
// opens a searchable menu that adds or replaces one. Results come from the
// screen through a ListSource, so long lists stay outside.
import type { ActorDisplay, Hue, RecordRefDisplay } from '@crm/contracts/values';
import { use, useEffect, useId, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Button } from '../atoms/Button/Button.tsx';
import { Icon } from '../atoms/Icon/Icon.tsx';
import { RecordChip } from '../atoms/RecordChip/RecordChip.tsx';
import { arraySource, type ListSource } from '../lib/list-source.ts';
import type { IconName } from '../atoms/Icon/icons.ts';
import { Menu, MenuTrigger } from '../molecules/Menu/Menu.tsx';
import { InPopover } from '../molecules/Popover/Popover.tsx';
import { Select } from '../molecules/Select/Select.tsx';
import { focusLater } from '../lib/focus-later.ts';
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

/**
 * What a search result says beside its name (spec 0014): a note read with it
 * ("At Acme", "Linked elsewhere"), and whether it is linked already, which
 * shows it as chosen.
 */
export interface ResultState {
  readonly note?: string;
  readonly isLinked?: boolean;
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
  /**
   * Offered first, before the results, while nothing is typed ("Me"). Once a search is typed only the results
   * show, so the first of them is what Enter picks: a pinned item that matches comes back among them, still
   * marked as pinned ("Me"), when `onSearch` answers it.
   */
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
  /** The objects the search can look in; a Select in the menu, above its search, picks one (spec 0019). Without it, nothing changes. */
  readonly objects?: readonly SearchObject[];
  /** The object searched now, one of `objects`. */
  readonly objectId?: string;
  readonly onObjectChange?: (objectId: string) => void;
  /**
   * Draws the attribute's name as the picker's visible label (in a form,
   * where nothing else names it); a cell or a panel row names it already.
   */
  readonly showLabel?: boolean;
  /**
   * Each result's note and chosen state (spec 0014): the note shows under
   * its name and screen readers read it with the item; a linked one shows
   * its check, and picking it again on a side of many changes nothing.
   */
  readonly describeResult?: (display: D) => ResultState | undefined;
  /** The form around it is sending: the chips show in Field's disabled look, and neither the box nor a Remove acts. */
  readonly isDisabled?: boolean;
}

/**
 * One field: the chosen references as removable chips inside a box drawn
 * like Field's, and a button filling the rest of it that opens a searchable
 * menu to pick one (a click anywhere on the box opens it too). In a grid
 * cell's popover, the chips over the search and its results, in place.
 */
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
  describeResult,
  isDisabled = false,
}: ReferencePickerProps<D>) {
  const labelId = useId();
  const errorId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(startQuery ?? '');
  const [isOpen, setOpen] = useState(false);
  const isInPopover = use(InPopover);
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
  // Pinned items lead only an empty search: kept first while typing, they took Enter from the person searched for.
  const shownPinned = query.trim() === '' ? pinned : [];
  const offered: ListSource<D> =
    results === undefined
      ? arraySource(pinned, keyOf)
      : {
          count: shownPinned.length + results.count,
          getItem: (index) =>
            index < shownPinned.length ? shownPinned[index] : results.getItem(index - shownPinned.length),
          getKey: keyOf,
          ...(results.onRangeChange === undefined
            ? {}
            : {
                onRangeChange: ({ start, end }) => {
                  results.onRangeChange?.({
                    start: Math.max(0, start - shownPinned.length),
                    end: Math.max(0, end - shownPinned.length),
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
    // Linked already (perhaps past the chips a cell shows): nothing to add.
    if (describeResult?.(found)?.isLinked === true) return;
    if (!chosen.some((item) => keyOf(item) === keyOf(found))) onChange([...chosen, found]);
  };
  const isMe = (display: D) => pinned.some((item) => keyOf(item) === keyOf(display));
  const boxRef = useRef<HTMLDivElement>(null);
  const searchLabel = strings.search(name);
  const hasObjects = objects !== undefined && objects.length > 0 && onObjectChange !== undefined;
  const currentObject = hasObjects ? (objects.find((object) => object.id === objectId) ?? objects[0]) : undefined;
  const menu = (
    <Menu<D>
      label={name}
      isInline={isInline}
      width="trigger"
      {...(isInline ? {} : { anchorRef: boxRef })}
      {...(hasObjects
        ? {
            // The object a record search looks in, inside the picker, above its search (spec 0019).
            header: (
              <>
                <span>{strings.searchIn}</span>
                <span className={styles.scope}>
                  <Select
                    label={strings.searchIn}
                    isLabelHidden
                    variant="inline"
                    size="sm"
                    items={objects.map((object) => ({
                      id: object.id,
                      label: object.label,
                      ...(object.icon === undefined ? {} : { icon: object.icon }),
                      ...(object.hue === undefined ? {} : { hue: object.hue }),
                    }))}
                    value={objectId ?? objects[0]?.id ?? null}
                    onChange={(id) => {
                      if (id === null) return;
                      onObjectChange(id);
                      // Back to the search, which now looks in the object chosen.
                      focusLater(() =>
                        [...document.querySelectorAll<HTMLInputElement>('input[type="search"]')].find(
                          (input) => input.getAttribute('aria-label') === searchLabel,
                        ),
                      );
                    }}
                  />
                </span>
              </>
            ),
          }
        : {})}
      search={{
        label: searchLabel,
        // The search says which object it looks in, as the header above it does.
        ...(currentObject === undefined ? {} : { placeholder: strings.searchObject(currentObject.label) }),
        onSearch: setQuery,
        ...(startQuery === undefined ? {} : { defaultQuery: startQuery }),
      }}
      source={offered}
      renderItem={(display) => {
        const state = describeResult?.(display);
        const email = 'email' in display ? display.email : undefined;
        // A note ("At Acme") is the result's second line, read with it; a member's email tells two people apart.
        const description = state?.note ?? email;
        return {
          children: display.name === '' ? strings.unknown : display.name,
          ...(isMe(display) ? { meta: strings.me } : {}),
          ...(description === undefined ? {} : { description }),
          // Linked already, or one of the chips: its check says picking it again changes nothing.
          ...(state?.isLinked === true || chosen.some((item) => keyOf(item) === keyOf(display))
            ? { isChecked: true }
            : {}),
        };
      }}
      onAction={pick}
    />
  );
  const chips =
    chosen.length === 0 ? null : (
      <ul className={styles.chosen} aria-label={name}>
        {chosen.map((display) => (
          <li key={keyOf(display)} className={styles.item}>
            <RecordChip display={display} isFlat={!isInline} />
            <Button
              variant="ghost"
              size={isInline ? 'md' : 'sm'}
              icon="x"
              label={strings.remove(display.name === '' ? name : display.name)}
              isDisabled={isDisabled}
              onPress={() => {
                const place = chosen.findIndex((item) => keyOf(item) === keyOf(display));
                onChange(chosen.filter((item) => keyOf(item) !== keyOf(display)));
                // The pressed button goes with its chip: focus moves to the next chip's, the one before, or the
                // picker's button, never to the page or the dialog's Close.
                focusLater(() => {
                  const removes = rootRef.current?.querySelectorAll<HTMLButtonElement>('ul > li button');
                  const list = removes === undefined ? [] : [...removes];
                  return list[Math.min(place, list.length - 1)] ?? triggerRef.current;
                });
              }}
            />
          </li>
        ))}
      </ul>
    );
  const errorLine =
    error === undefined ? null : (
      <span id={errorId} className={styles.error} role="alert">
        <Icon name="circle-alert" size="xs" />
        {error}
      </span>
    );
  if (isInline) {
    return (
      <div ref={rootRef} className={styles.root} data-inline="">
        {chips}
        {menu}
        {errorLine}
      </div>
    );
  }
  const isEmpty = chosen.length === 0;
  // The button's name: what pressing it does, since past the first pick it shows only its chevron.
  const triggerLabel = isEmpty ? undefined : allowMultiple ? strings.addAnother : strings.change(name);
  return (
    <div
      ref={rootRef}
      className={styles.root}
      // On a form the field is a named group, and while its form sends the whole group is off, chips included.
      {...(showLabel
        ? { role: 'group', 'aria-labelledby': labelId, ...(isDisabled ? { 'aria-disabled': true } : {}) }
        : {})}
    >
      {showLabel && (
        <span id={labelId} className={styles.label}>
          {name}
        </span>
      )}
      {/* The box is the field: a click on it (not on a chip's Remove) opens the search, as its button does by key. */}
      {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions -- the button inside is the keyboard path */}
      <div
        ref={boxRef}
        className={styles.box}
        data-size={isCompact ? 'sm' : 'md'}
        data-invalid={error === undefined ? undefined : ''}
        data-open={(isOpen && !isDisabled) || undefined}
        data-disabled={isDisabled || undefined}
        // In a popover (a grid cell's editor) its focus is the accent edge alone, as a Field's there.
        data-in-popover={isInPopover || undefined}
        onClick={(event) => {
          if (isDisabled || (event.target instanceof Element && event.target.closest('button, a') !== null)) return;
          setOpen(true);
        }}
      >
        {/* The field's own button comes first for Tab (a reflexive Enter never removes a chip); CSS draws it last. */}
        <MenuTrigger isOpen={isOpen && !isDisabled} onOpenChange={setOpen}>
          <AriaButton
            ref={triggerRef}
            className={styles.trigger}
            isDisabled={isDisabled}
            {...(triggerLabel === undefined ? {} : { 'aria-label': triggerLabel })}
            {...(error === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': errorId })}
          >
            {isEmpty && <span className={styles.placeholder}>{strings.choose(name)}</span>}
            <Icon name="chevron-down" size="sm" tone="muted" />
          </AriaButton>
          {menu}
        </MenuTrigger>
        {chips}
      </div>
      {errorLine}
    </div>
  );
}
