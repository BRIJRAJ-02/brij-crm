import { useEffect, useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import styles from './DeferredSelect.module.css';
import type { Select as SelectComponent, SelectProps } from './Select.tsx';

/** Props for DeferredSelect: an inline Select's, less what a stand in can't keep. */
export type DeferredSelectProps = Pick<
  SelectProps,
  | 'label'
  | 'items'
  | 'value'
  | 'onChange'
  | 'isDisabled'
  | 'showsDescription'
  | 'isSearchable'
  | 'searchLabel'
  | 'filter'
  | 'rank'
  | 'placement'
  | 'onOpenChange'
> & {
  /**
   * Shown while nothing is chosen. Given by the caller, since Select's own default ("Choose…") would bring its copy
   * into the first load: an inline select nearly always has a value (a visitor's time zone).
   */
  readonly placeholder: string;
  /**
   * When the list's code loads: `idle`, once the page has loaded and the browser is idle (the default), or only on
   * `intent`, the first hover, focus or press. Either way the first intent loads it at once.
   */
  readonly preload?: 'idle' | 'intent';
};

// Select's code (React Aria's Select, ListBox and Autocomplete, and its own styles) as its own chunk.
const loadSelect = () => import('./Select.tsx');

/** Calls `start` once the page has loaded and the browser is idle; answers the cleanup. */
function whenIdle(start: () => void): () => void {
  let cancel: () => void = () => undefined;
  const idle = () => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      const id = globalThis.requestIdleCallback(start, { timeout: 5_000 });
      cancel = () => globalThis.cancelIdleCallback(id);
      return;
    }
    const timer = globalThis.setTimeout(start, 2_000);
    cancel = () => globalThis.clearTimeout(timer);
  };
  if (document.readyState === 'complete') {
    idle();
    return () => cancel();
  }
  globalThis.addEventListener('load', idle, { once: true });
  return () => {
    globalThis.removeEventListener('load', idle);
    cancel();
  };
}

/** The keys that open a closed Select's list from its trigger: the arrows, with or without Alt. */
const OPENING_KEYS = new Set(['ArrowDown', 'ArrowUp']);

/**
 * An inline Select (a booking page's time zone, in a line of its rail) whose list loads apart from the page's first
 * paint. Until its code arrives a stand in draws the same closed trigger, the same button with the same name, in the
 * same place; the first hover, focus or press loads it, and the press that started it opens the list once it is in,
 * so one press always opens it. The real Select then takes the stand in's place, and the focus with it.
 */
export function DeferredSelect({ preload = 'idle', onOpenChange, ...props }: DeferredSelectProps) {
  const [loaded, setLoaded] = useState<{ readonly Select: typeof SelectComponent } | undefined>(undefined);
  // What the visitor did on the stand in, so the real one picks up where they are: open, or focused.
  const [opens, setOpens] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [wanted, setWanted] = useState(false);
  // The real trigger, and whether its first close has put focus back on it (see onOpenChange below).
  const trigger = useRef<HTMLButtonElement>(null);
  const hasReturnedFocus = useRef(false);
  const triggerId = useId();
  const valueId = useId();

  useEffect(() => {
    if (!wanted && preload === 'intent') return;
    let isCurrent = true;
    const load = () => {
      loadSelect().then(
        (module) => {
          if (isCurrent) setLoaded({ Select: module.Select });
        },
        // A chunk that fails to load leaves the stand in, and the next intent asks again.
        () => {
          if (!isCurrent) return;
          setWanted(false);
          setOpens(false);
        },
      );
    };
    if (wanted) {
      load();
      return () => {
        isCurrent = false;
      };
    }
    const cancel = whenIdle(load);
    return () => {
      isCurrent = false;
      cancel();
    };
  }, [wanted, preload]);

  if (loaded !== undefined) {
    const { Select } = loaded;
    return (
      <Select
        {...props}
        isLabelHidden
        variant="inline"
        triggerRef={trigger}
        onOpenChange={(isOpen) => {
          onOpenChange?.(isOpen);
          // A list opened as it mounted keeps the stand in, long gone, as the place to hand focus back to, so its
          // first close would leave focus nowhere: put it on the trigger, as every later close does by itself.
          if (isOpen || !opens || hasReturnedFocus.current) return;
          hasReturnedFocus.current = true;
          focusLater(() => (document.activeElement === document.body ? trigger.current : undefined));
        }}
        // The list opens on the press that loaded it (its search takes the focus); else focus stays where it was.
        {...(opens ? { defaultOpen: true } : hasFocus ? { autoFocus: true } : {})}
      />
    );
  }

  const { label, items, value, placeholder, isDisabled = false, showsDescription = false } = props;
  const chosen = items.find((item) => item.id === value);
  const want = () => setWanted(true);
  const open = () => {
    setWanted(true);
    setOpens(true);
  };
  return (
    <div className={styles.root} data-disabled={isDisabled || undefined}>
      {/* The same button React Aria's Select draws closed: named by its value, then its label. */}
      <button
        type="button"
        id={triggerId}
        className={styles.trigger}
        disabled={isDisabled}
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-label={label}
        aria-labelledby={`${valueId} ${triggerId}`}
        onPointerEnter={want}
        onFocus={() => {
          setHasFocus(true);
          want();
        }}
        onBlur={() => setHasFocus(false)}
        // A pointer opens on the press, as the real one does, so a release after the swap still opened it.
        onPointerDown={(event: PointerEvent) => {
          if (event.button === 0) open();
        }}
        // Enter and Space (and a tap, which may come without a pointer down first).
        onClick={open}
        onKeyDown={(event: KeyboardEvent) => {
          if (!OPENING_KEYS.has(event.key)) return;
          event.preventDefault();
          open();
        }}
      >
        <span id={valueId} className={styles.value}>
          {chosen === undefined ? (
            <span className={styles.placeholder}>{placeholder}</span>
          ) : (
            <>
              <span className={styles.plain}>{chosen.label}</span>
              {showsDescription && chosen.description !== undefined && (
                <span className={styles.description}>{chosen.description}</span>
              )}
            </>
          )}
        </span>
        <Icon name="chevron-down" size="sm" tone="muted" />
      </button>
    </div>
  );
}
