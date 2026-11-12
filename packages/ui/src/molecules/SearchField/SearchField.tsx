// SearchField (spec 0073, AC-7304): the prototype's SearchField as a thin wrapper over Field's `search` variant, so it
// adds no CSS of its own. It brings what every hand made search field was missing: a clear button, Esc to clear, an
// optional shortcut with its keycap, and a debounced `onSearch`, so a screen filtering a long list does its work once
// typing pauses rather than on every key (spec 0073's scalability gate, AC-7322).
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Kbd } from '../../atoms/Kbd/Kbd.tsx';
import { Field } from '../Field/Field.tsx';
import { strings } from './strings.ts';

/** How long typing must pause before `onSearch` runs: spec 0014's pause, the same as the data layer's record search. */
export const SEARCH_DEBOUNCE_MS = 150;

/** Props for SearchField. */
export interface SearchFieldProps {
  /** What it searches: its accessible name, and its placeholder unless `placeholder` says otherwise ("Search people"). */
  readonly label: string;
  readonly placeholder?: string;
  /** What is typed, for a controlled field; leave it out and give `defaultValue` for one that keeps its own. */
  readonly value?: string;
  readonly defaultValue?: string;
  /** Every change, at once: for showing what is typed. Filter on `onSearch` instead. */
  readonly onChange?: (value: string) => void;
  /**
   * The query to search or filter by: `debounceMs` after typing stops, and at once on Enter and on clear. The same
   * query twice in a row is sent once. A controlled `value` the parent changes itself counts as applied by the
   * parent, so the next query typed is compared with it, not with the last one sent.
   */
  readonly onSearch?: (query: string) => void;
  /** How long typing must pause before `onSearch`. Defaults to `SEARCH_DEBOUNCE_MS`. */
  readonly debounceMs?: number;
  /** Enter: open the first result, run the search. `onSearch` has already had the query. */
  readonly onSubmit?: (value: string) => void;
  /** The field was cleared, by its clear button or Esc. */
  readonly onClear?: () => void;
  /**
   * A shortcut that focuses and selects the field from anywhere outside another field: `⌘K` (which Ctrl+K also
   * answers) or one key such as `/`. Its keycap shows while the field is empty and not focused. Never give two
   * fields on one screen the same shortcut, and leave `⌘K` to the command palette where one is mounted.
   */
  readonly shortcut?: string;
  /** `md` (the default) on its own; `sm` in a toolbar. */
  readonly size?: 'md' | 'sm';
  readonly isDisabled?: boolean;
  /** Why it is off, said as its tooltip. */
  readonly disabledReason?: string;
  /** Takes focus as it mounts: a search at the top of a list that just opened. */
  readonly autoFocus?: boolean;
}

/** Whether a key press happened inside something that takes typing, where a one key shortcut must stay a letter. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName);
}

/** Whether `event` is `shortcut`: `⌘K` with ⌘ or Ctrl, or a single key with no modifier outside a field. */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const withModifier = shortcut.startsWith('⌘');
  const key = shortcut.slice(-1).toLowerCase();
  if (event.key.toLowerCase() !== key || event.altKey) return false;
  if (withModifier) return event.metaKey || event.ctrlKey;
  return !event.metaKey && !event.ctrlKey && !isTyping(event.target);
}

/**
 * A rounded search field for narrowing a list as you type, or for opening search from a shortcut. A clear button
 * shows while it holds text; Esc clears it and keeps focus (with nothing typed, Esc goes on to whatever holds the
 * field, such as a popover). Built on Field, so it looks and reads like every other field.
 */
export function SearchField({
  label,
  placeholder,
  value,
  defaultValue = '',
  onChange,
  onSearch,
  debounceMs = SEARCH_DEBOUNCE_MS,
  onSubmit,
  onClear,
  shortcut,
  size = 'md',
  isDisabled = false,
  disabledReason,
  autoFocus = false,
}: SearchFieldProps) {
  const [own, setOwn] = useState(defaultValue);
  const text = value ?? own;
  const [isFocused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The last query `onSearch` was given, so a pause after Enter, or a clear of an empty field, sends nothing twice.
  const sent = useRef(text);
  // The last text the field itself reported, and whether a report is in this render (the parent echoing it, or
  // reshaping it, as it does in its `onChange`). A controlled `value` that is neither was set by the parent (a
  // Clear filters button, a route change), which has applied it itself: it becomes the query sent, so typing the
  // old query again sends it again.
  const reported = useRef(text);
  const isReporting = useRef(false);
  // What the field holds now, for a pause that ends after the parent changed it: the pause sends what is shown.
  const latest = useRef(text);
  const search = useRef(onSearch);
  useEffect(() => {
    search.current = onSearch;
    latest.current = text;
  });
  useEffect(() => {
    if (value === undefined) return;
    if (!isReporting.current && value !== reported.current) sent.current = value;
    reported.current = value;
  }, [value]);
  useEffect(() => {
    isReporting.current = false;
  });

  const sendNow = (query: string) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (query === sent.current) return;
    sent.current = query;
    search.current?.(query);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (shortcut === undefined || isDisabled) return undefined;
    const doc = input.current?.ownerDocument;
    if (doc === undefined) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesShortcut(event, shortcut)) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('keydown', onKeyDown);
    };
  }, [shortcut, isDisabled]);

  const change = (next: string) => {
    reported.current = next;
    isReporting.current = true;
    setOwn(next);
    onChange?.(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      sendNow(latest.current);
    }, debounceMs);
  };

  const clear = () => {
    reported.current = '';
    isReporting.current = true;
    setOwn('');
    onChange?.('');
    sendNow('');
    onClear?.();
    input.current?.focus();
  };

  const hasText = text !== '';
  const showsKeycap = shortcut !== undefined && !hasText && !isFocused && !isDisabled;
  return (
    <Field
      label={label}
      isLabelHidden
      placeholder={placeholder ?? label}
      variant="search"
      size={size}
      type="search"
      autoComplete="off"
      value={text}
      onChange={change}
      isDisabled={isDisabled}
      {...(disabledReason === undefined ? {} : { disabledReason })}
      // The caller's choice, handed to Field, which focuses as React Aria expects (a list's search as it opens).
      // eslint-disable-next-line jsx-a11y-x/no-autofocus
      autoFocus={autoFocus}
      ref={input}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      onSubmit={() => {
        sendNow(text);
        onSubmit?.(text);
      }}
      // With nothing typed, Esc is not the field's: it goes on to close what holds it.
      {...(hasText ? { onEscape: clear } : {})}
      {...(hasText && !isDisabled
        ? { suffix: <Button variant="ghost" size="sm" icon="x" label={strings.clear} onPress={clear} /> }
        : showsKeycap
          ? { suffix: <Kbd tone="soft">{shortcut}</Kbd> }
          : {})}
    />
  );
}
