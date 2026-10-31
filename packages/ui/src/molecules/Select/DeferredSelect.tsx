import { useEffect, useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import styles from './DeferredSelect.module.css';
import type { SelectItem, SelectProps } from './Select.tsx';
import type { Select as SelectComponent } from './SelectWithFaces.tsx';

/**
 * One option of a DeferredSelect: a plain one, its label and its `description`. The stand in draws only these, so an
 * icon, a leading piece, a badge or a hue, which the real trigger would draw, are ruled out rather than jumping in.
 */
export type DeferredSelectItem = Omit<SelectItem, 'icon' | 'leading' | 'badge' | 'hue' | 'short'> & {
  readonly icon?: never;
  readonly leading?: never;
  readonly badge?: never;
  readonly hue?: never;
  readonly short?: never;
};

/** Props for DeferredSelect: an inline Select's, less what a stand in can't keep. */
export type DeferredSelectProps = Pick<
  SelectProps,
  | 'label'
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
  readonly items: readonly DeferredSelectItem[];
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

/** What DeferredSelect loads: Select's module, or anything with its Select. */
export type SelectModule = { readonly Select: typeof SelectComponent };

// Select's code (React Aria's Select, ListBox and Autocomplete, and its own styles) as its own chunk.
const loadSelect = (): Promise<SelectModule> => import('./SelectWithFaces.tsx');

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

/**
 * The keys that open a closed Select's list from its trigger: the arrows (with or without Alt), and Space, taken on
 * its key down so a swap between its down and its up can't lose it. Enter's click already comes on its key down.
 */
const OPENING_KEYS = new Set(['ArrowDown', 'ArrowUp', ' ']);

/**
 * An inline Select (a booking page's time zone, in a line of its rail) whose list loads apart from the page's first
 * paint. Until its code arrives a stand in draws the same closed trigger, the same button with the same name, in the
 * same place; the first hover, focus or press loads it, and the press that started it opens the list once it is in,
 * so one press always opens it. The real Select then takes the stand in's place.
 */
export function DeferredSelect(props: DeferredSelectProps) {
  return <DeferredSelectFrom {...props} load={loadSelect} />;
}

/**
 * DeferredSelect with its loader given: its stories hold the code back, to press the stand in itself and to fail the
 * load. Screens use DeferredSelect.
 */
export function DeferredSelectFrom({
  preload = 'idle',
  onOpenChange,
  load,
  ...props
}: DeferredSelectProps & { readonly load: () => Promise<SelectModule> }) {
  const [loaded, setLoaded] = useState<SelectModule | undefined>(undefined);
  // What the visitor did on the stand in, so the real one picks up where they are: a press waiting for the list.
  const [opens, setOpens] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [wanted, setWanted] = useState(false);
  // A load that failed is asked for again only on the next intent, never on idle in a loop.
  const [hasFailed, setHasFailed] = useState(false);
  // The real trigger, and whether its first close has put focus back on it (see onOpenChange below).
  const trigger = useRef<HTMLButtonElement>(null);
  const standIn = useRef<HTMLButtonElement>(null);
  const hasReturnedFocus = useRef(false);
  const triggerId = useId();
  const valueId = useId();

  useEffect(() => {
    if (!wanted && (preload === 'intent' || hasFailed)) return;
    let isCurrent = true;
    const start = () => {
      load().then(
        (module) => {
          if (isCurrent) setLoaded({ Select: module.Select });
        },
        // The stand in stays, and doesn't open later on its own. A browser may keep a failed import as failed, so
        // the next intent's ask can fail at once; the time zone the page already shows stays right.
        () => {
          if (!isCurrent) return;
          setHasFailed(true);
          setWanted(false);
          setOpens(false);
        },
      );
    };
    if (wanted) {
      start();
      return () => {
        isCurrent = false;
      };
    }
    const cancel = whenIdle(start);
    return () => {
      isCurrent = false;
      cancel();
    };
  }, [wanted, preload, hasFailed, load]);

  // A press waiting for the list is called off by a press anywhere else, as a click outside closes an open list.
  useEffect(() => {
    if (!opens || loaded !== undefined) return;
    const away = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && standIn.current?.contains(event.target) === true) return;
      setOpens(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [opens, loaded]);

  // The real Select takes over once it is in, unless the stand in has the focus and no press waits: swapping the
  // focused button would drop focus for a moment (and a screen reader would read it twice), so it waits for a press
  // or for focus to move on.
  if (loaded !== undefined && (opens || !hasFocus)) {
    const { Select } = loaded;
    return (
      <Select
        {...props}
        isLabelHidden
        variant="inline"
        triggerRef={trigger}
        // The list opens on the press that loaded it, its search taking the focus.
        {...(opens ? { defaultOpen: true } : {})}
        onOpenChange={(isOpen) => {
          onOpenChange?.(isOpen);
          // A list opened as it mounted keeps the stand in, long gone, as the place to hand focus back to, so its
          // first close would leave focus nowhere: put it on the trigger, as every later close does by itself.
          // (Only when focus is lost: a list opened on the real trigger hands it back by itself.)
          if (isOpen || hasReturnedFocus.current) return;
          hasReturnedFocus.current = true;
          focusLater(() => (document.activeElement === document.body ? trigger.current : undefined));
        }}
      />
    );
  }

  const { label, items, value, placeholder, isDisabled = false, showsDescription = false } = props;
  const chosen = items.find((item) => item.id === value);
  // A disabled one neither loads nor opens on a hover or press (its pointer events still arrive in some browsers).
  const want = () => {
    if (!isDisabled) setWanted(true);
  };
  const open = () => {
    if (isDisabled) return;
    setWanted(true);
    setOpens(true);
  };
  return (
    <div className={styles.root} data-disabled={isDisabled || undefined}>
      {/* The same button React Aria's Select draws closed: named by its value, then its label. */}
      <button
        ref={standIn}
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
        onBlur={() => {
          setHasFocus(false);
          setOpens(false);
        }}
        // A mouse opens on the press, as the real one does, so a release after the swap still opened it. A touch
        // waits for its tap (the click below): a scroll that starts on the line must not open the list.
        onPointerDown={(event: PointerEvent) => {
          if (event.button === 0 && event.pointerType === 'mouse') open();
          else want();
        }}
        // Enter, and a tap.
        onClick={open}
        onKeyDown={(event: KeyboardEvent) => {
          // Esc calls off a press still waiting for the list.
          if (event.key === 'Escape') {
            setOpens(false);
            return;
          }
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
