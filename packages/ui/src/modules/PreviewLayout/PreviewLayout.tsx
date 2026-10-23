import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { CardTitleLevel } from '../../molecules/Card/Card.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import styles from './PreviewLayout.module.css';
import { strings } from './strings.ts';

/**
 * The phone the preview is drawn in, in CSS pixels: the page is laid out at its width, then scaled down to fit the
 * column's width (never above 1). It is as tall as the room under the heading allows, from `minHeight` up to a real
 * phone's `height`: on a laptop's view the phone gets shorter rather than smaller, so the page in it stays readable
 * (the owner, 23 Oct 2026: "increase preview a bit"). With less room than `minHeight`, it scales down to fit.
 * The page in it scrolls (PreviewFrame), so its foot is never out of reach however short the phone is.
 */
const PHONE = { width: 375, height: 812, minHeight: 640 } as const;

/** Props for PreviewLayout. */
export interface PreviewLayoutProps {
  /** The editor's groups: Cards of Fields, a list, a table. */
  readonly children: ReactNode;
  /** Above the body, full width: a read only note, a refused publish's Callout, a teammate's change. */
  readonly notices?: ReactNode;
  /**
   * What the editor shows itself as, drawn in a phone: a `PreviewFrame` (a page in a frame) or a drawn preview
   * (`HostedFormPreview`). Sticky in the last third of the width beside the body, or behind a "Preview" button
   * that opens it in a sheet when they don't both fit. Leave it out on a tab with nothing to preview.
   */
  readonly preview?: ReactNode;
  /**
   * The preview's controls, at the end of its header row beside its "Preview" heading (a form's look Selects with
   * hidden labels and `size="sm"`, their values saying what they set).
   */
  readonly previewControls?: ReactNode;
  /** Between the controls and the phone, when what it shows needs a word ("This page is off"). */
  readonly previewNote?: ReactNode;
  /** A bar pinned to the body's foot while it has something to say: the SaveBar. */
  readonly footer?: ReactNode;
  /**
   * `stack` (the default) stacks the body's groups; `grid` sets them in as
   * many columns as fit, each at least the panel's width (a settings tab's
   * Cards, side by side where there is room).
   */
  readonly bodyLayout?: 'stack' | 'grid';
  /**
   * `form` holds the body's groups to `size-column-max`, centred in the body's column, so a Select sits near its
   * label on a wide view (no screen uses it since the booking page editor went full width, 23 Oct 2026); `full` (the
   * default) takes the column's width.
   */
  readonly bodyWidth?: 'full' | 'form';
}

/** Where an editor's subject stands, as the TopBar's status says it. */
export type EditorStatusTone = 'live' | 'changed' | 'draft' | 'paused';

/** Each tone's dot: live green, changed orange, the rest gray. */
const TONE_HUES = { live: 'green', changed: 'orange', draft: 'gray', paused: 'gray' } as const;

/**
 * The editor's status for the TopBar's meta, beside the name: a StatusDot,
 * green when live, orange when changed since it was published, gray when not
 * published or paused. The words say it too: in full from 480px, as one word on a phone's bar (Live, Edited,
 * Draft, Paused), and in full to screen readers always.
 */
export function EditorStatus({ tone, text }: { readonly tone: EditorStatusTone; readonly text: string }) {
  // An editor's own state, not an attribute value, so StatusDot draws it here.
  // On a phone's bar a short word replaces the full words, so the name keeps its room; screen readers read them all.
  return (
    <StatusDot hue={TONE_HUES[tone]} shortLabel={strings.shortStatus[tone]}>
      {text}
    </StatusDot>
  );
}

/** Props for PreviewFrame. */
export interface PreviewFrameProps {
  /** The page previewed: its address, loaded in a frame, and what it is. */
  readonly src: string;
  readonly title: string;
  /** Changes when what the preview shows was saved, so the frame loads it again. */
  readonly version?: string;
  /**
   * What the editor holds now, posted to the frame (same origin only) whenever
   * it changes and once the frame loads, so the page can show unsaved edits.
   */
  readonly draft?: unknown;
}

/** How far an arrow key, or a wheel's line, moves the page, in its own pixels: a browser's step. */
const LINE_STEP = 40;

/** A page step (Page Up or Down, Space) keeps this share of the screen in view, as a browser's does. */
const PAGE_STEP = 0.875;

/**
 * Wheel events closer together than this are one gesture (a trackpad's swipe and its momentum). A gesture the
 * page took stays with the page at its end, as a browser holds a scroll to the box it started in, so the editor
 * behind doesn't jump; the next one goes on to the editor.
 */
const GESTURE_GAP_MS = 150;

/** The page in a frame: its window, and the element whose scroll is the page's. */
interface FramePage {
  readonly view: Window;
  readonly root: Element;
}

/** The page in `frame`, or undefined while it loads or when it is another origin's (the browser keeps it closed). */
function pageIn(frame: HTMLIFrameElement | null): FramePage | undefined {
  try {
    const view = frame?.contentWindow ?? undefined;
    const root = view?.document.scrollingElement ?? undefined;
    return view === undefined || root === undefined ? undefined : { view, root };
  } catch {
    return undefined;
  }
}

/** Whether the page can move any of the way asked; at its end, a new gesture goes on to the editor's page. */
function canMove(root: Element, left: number, top: number): boolean {
  const maxTop = root.scrollHeight - root.clientHeight;
  const maxLeft = root.scrollWidth - root.clientWidth;
  return (
    (top > 0 && root.scrollTop < maxTop - 1) ||
    (top < 0 && root.scrollTop > 0) ||
    (left > 0 && root.scrollLeft < maxLeft - 1) ||
    (left < 0 && root.scrollLeft > 0)
  );
}

/** Where a key takes the page, as a browser's own keys scroll one, and whether it is a line's step; undefined for any other key. */
function keyScroll(
  event: ReactKeyboardEvent,
  root: Element,
): { readonly to: { readonly left: number; readonly top: number }; readonly isLine: boolean } | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
  const { scrollLeft: left, scrollTop: top } = root;
  const page = root.clientHeight * PAGE_STEP;
  switch (event.key) {
    case 'ArrowDown':
      return { to: { left, top: top + LINE_STEP }, isLine: true };
    case 'ArrowUp':
      return { to: { left, top: top - LINE_STEP }, isLine: true };
    case 'ArrowRight':
      return { to: { left: left + LINE_STEP, top }, isLine: true };
    case 'ArrowLeft':
      return { to: { left: left - LINE_STEP, top }, isLine: true };
    case 'PageDown':
      return { to: { left, top: top + page }, isLine: false };
    case 'PageUp':
      return { to: { left, top: top - page }, isLine: false };
    case ' ':
      return { to: { left, top: event.shiftKey ? top - page : top + page }, isLine: false };
    case 'Home':
      return { to: { left, top: 0 }, isLine: false };
    case 'End':
      return { to: { left, top: root.scrollHeight }, isLine: false };
    default:
      return undefined;
  }
}

/** How far the phone is scaled: its screen's drawn height over its laid out one (1 before it lays out). */
function scaleOf(element: HTMLElement): number {
  return element.offsetHeight === 0 ? 1 : element.getBoundingClientRect().height / element.offsetHeight;
}

/**
 * The scroll of a page in an inert frame: a wheel, trackpad or finger over the phone scrolls the page (the frame
 * takes no events of its own), and while the page runs past the phone's foot, the screen is a focusable region whose
 * keys scroll it. The page itself is left alone: it scrolls its own document at the phone's size.
 */
function useFrameScroll(frame: RefObject<HTMLIFrameElement | null>) {
  const ref = useRef<HTMLDivElement>(null);
  // Counts the frame's loads, so the watch below moves to each new page (a save loads the frame again).
  const [loads, setLoads] = useState(0);
  const [isLong, setLong] = useState(false);
  // The stop stays while it holds focus (a save loads the page again, short until its data arrives), so focus
  // never drops to the document.
  const [isFocused, setFocused] = useState(false);

  useEffect(() => {
    const page = pageIn(frame.current);
    if (page === undefined) return;
    const check = () => {
      setLong(page.root.scrollHeight > page.root.clientHeight || page.root.scrollWidth > page.root.clientWidth);
    };
    let pending = 0;
    const checkSoon = () => {
      page.view.cancelAnimationFrame(pending);
      pending = page.view.requestAnimationFrame(check);
    };
    // The page's own observers, from its window. A booking page's root is the window's height and its content
    // spills past it, so the document never resizes as the data arrives after load: what changes is its content
    // (and an image loading in it). A taller phone can end the overflow with no change at all but its own size.
    const realm = page.view as Window & typeof globalThis;
    const resizes = new realm.ResizeObserver(checkSoon);
    resizes.observe(page.view.document.documentElement);
    const mutations = new realm.MutationObserver(checkSoon);
    mutations.observe(page.view.document, { childList: true, subtree: true, characterData: true });
    page.view.addEventListener('resize', checkSoon);
    page.view.document.addEventListener('load', checkSoon, true);
    return () => {
      page.view.cancelAnimationFrame(pending);
      resizes.disconnect();
      mutations.disconnect();
      page.view.removeEventListener('resize', checkSoon);
      page.view.document.removeEventListener('load', checkSoon, true);
    };
  }, [frame, loads]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    let gestureAt = Number.NEGATIVE_INFINITY;
    const onWheel = (event: WheelEvent) => {
      // A pinch (a wheel with Ctrl) zooms the editor, as it would anywhere on it.
      if (event.ctrlKey) return;
      const page = pageIn(frame.current);
      if (page === undefined) return;
      // Pixels move the page as far as the fingers go on the scaled phone; lines and pages are the page's own.
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_STEP
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? page.root.clientHeight * PAGE_STEP
            : 1 / scaleOf(element);
      const left = event.deltaX * unit;
      const top = event.deltaY * unit;
      const isSameGesture = event.timeStamp - gestureAt < GESTURE_GAP_MS;
      if (!isSameGesture && !canMove(page.root, left, top)) return;
      event.preventDefault();
      gestureAt = event.timeStamp;
      page.view.scrollBy({ left, top, behavior: 'instant' });
    };
    // A finger drags the page with it (the screen has `touch-action: none` while the page is long, so the sheet
    // around it doesn't pan instead). A touch pointer is held by the screen it went down on until it lifts.
    let touch: { readonly id: number; readonly x: number; readonly y: number } | undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && event.isPrimary)
        touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (touch?.id !== event.pointerId) return;
      const page = pageIn(frame.current);
      const scale = scaleOf(element);
      page?.view.scrollBy({
        left: (touch.x - event.clientX) / scale,
        top: (touch.y - event.clientY) / scale,
        behavior: 'instant',
      });
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (touch?.id === event.pointerId) touch = undefined;
    };
    // Not passive: a wheel the page takes mustn't also scroll the editor behind it.
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerEnd);
    element.addEventListener('pointercancel', onPointerEnd);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerEnd);
      element.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [frame]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const page = pageIn(frame.current);
    if (page === undefined) return;
    const scroll = keyScroll(event, page.root);
    // At the page's end the key goes on to the editor, as a wheel does.
    if (
      scroll === undefined ||
      !canMove(page.root, scroll.to.left - page.root.scrollLeft, scroll.to.top - page.root.scrollTop)
    )
      return;
    event.preventDefault();
    // A screen's step glides; a line's, a held key's and every step with reduced motion are at once (a glide that
    // restarts on each repeat stutters).
    const isReduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isInstant = scroll.isLine || event.repeat || isReduced;
    page.view.scrollTo({ ...scroll.to, behavior: isInstant ? 'instant' : 'smooth' });
  };

  return {
    ref,
    onLoad: () => {
      setLoads((count) => count + 1);
    },
    screen: {
      ...(isLong ? { 'data-long': true } : {}),
      ...(isLong || isFocused ? { tabIndex: 0, role: 'region', 'aria-label': strings.phone, onKeyDown } : {}),
      onFocus: () => {
        setFocused(true);
      },
      onBlur: () => {
        setFocused(false);
      },
    },
  };
}

/**
 * A page in a frame, filling the phone PreviewLayout draws it in. The page is to look at: the frame is inert and
 * out of the tab order, so pressing in it never books. It scrolls all the same: a wheel, trackpad or finger over the
 * phone scrolls the page, and while the page runs past the phone's foot, the screen takes one tab stop (a region named
 * "Phone preview") where the arrows, Page Up and Down, Space, Home and End scroll it.
 */
export function PreviewFrame({ src, title, version, draft }: PreviewFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { ref, onLoad, screen } = useFrameScroll(frame);
  const post = () => {
    if (draft === undefined) return;
    frame.current?.contentWindow?.postMessage({ type: 'crm:preview', draft }, globalThis.location.origin);
  };
  useEffect(post);
  return (
    <div ref={ref} className={styles.viewport} {...screen}>
      {/* A picture of the page, not a second copy to use: nothing in it takes focus or a press. */}
      <iframe
        key={version ?? ''}
        ref={frame}
        className={styles.iframe}
        src={src}
        title={strings.previewOf(title)}
        tabIndex={-1}
        loading="lazy"
        inert
        onLoad={() => {
          post();
          onLoad();
        }}
      />
    </div>
  );
}

/** How the phone fits the stage: its scale (never above 1) and the height its page is laid out at. */
interface PhoneFit {
  readonly scale: number;
  readonly height: number;
}

/** The scale that fits the phone into the stage's width, and the height the stage leaves it (see `PHONE`). */
function usePhoneFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<PhoneFit>({ scale: 1, height: PHONE.height });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      // Less the phone's two hairlines, so its outline fits too.
      const scale = Math.min(1, (width - 2) / PHONE.width, (height - 2) / PHONE.minHeight);
      setFit({ scale, height: Math.min(PHONE.height, Math.floor((height - 2) / scale)) });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, ...fit };
}

/** Whether the screen's content runs past its foot (a long form), so it scrolls and takes focus to be scrolled. */
function useOverflow() {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const check = () => {
      setOverflowing(element.scrollHeight > element.clientHeight);
    };
    const observer = new ResizeObserver(check);
    observer.observe(element);
    // The content's own size changes as a form gains questions; the screen's never does.
    if (element.firstElementChild !== null) observer.observe(element.firstElementChild);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, isOverflowing };
}

/** Props for PhoneColumn. */
interface PhoneColumnProps {
  /** Where it is drawn: the column beside the body, or the narrow layout's sheet. */
  readonly place: 'side' | 'sheet';
  /** The heading's id, which names the column beside the body. */
  readonly headingId?: string;
  readonly controls?: ReactNode;
  readonly note?: ReactNode;
  /** What the phone shows. */
  readonly children: ReactNode;
}

/**
 * The preview's column: the "Preview" heading with the controls at its end, as wide as the phone at least and
 * centred over it, then any note, then the phone. The phone lays the page out at a phone's size and is scaled to
 * fit the room left under them (never above 1). When what it shows runs past the phone's foot (a long form), the
 * screen scrolls, and takes focus so the keyboard can scroll it too.
 */
function PhoneColumn({ place, headingId, controls, note, children }: PhoneColumnProps) {
  const { ref, scale, height } = usePhoneFit();
  const { ref: screenRef, isOverflowing } = useOverflow();
  return (
    <div
      className={styles.preview}
      data-place={place}
      style={{
        '--phone-width': `${String(PHONE.width)}px`,
        '--phone-height': `${String(height)}px`,
        '--phone-scale': String(scale),
      }}
    >
      <div className={styles.head}>
        <h2 className={styles.heading} {...(headingId === undefined ? {} : { id: headingId })}>
          {strings.preview}
        </h2>
        {controls !== undefined && <div className={styles.controls}>{controls}</div>}
      </div>
      {note}
      <div ref={ref} className={styles.stage}>
        <div className={styles.phone}>
          <div
            ref={screenRef}
            className={styles.screen}
            {...(isOverflowing ? { tabIndex: 0, role: 'region', 'aria-label': strings.phone } : {})}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Every Captures editor's body under its TopBar (the booking page editor, the
 * form editor): any notices, then the body at the page gutter in the first
 * two thirds of the width, beside a sticky phone preview centred in the last
 * third. When the layout's own width can't hold both (a container query), the
 * column hides and a "Preview" button over the body opens the phone in a
 * sheet. `footer` pins the SaveBar to the body's foot.
 */
export function PreviewLayout({
  children,
  notices,
  preview,
  previewControls,
  previewNote,
  footer,
  bodyLayout = 'stack',
  bodyWidth = 'full',
}: PreviewLayoutProps) {
  // The sheet's phone is drawn only while it is open, so a narrow page loads no second frame until asked.
  const [isOpen, setOpen] = useState(false);
  const hasPreview = preview !== undefined && preview !== null;
  const headingId = useId();
  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        {notices}
        <div className={styles.measure}>
          {hasPreview && (
            <div className={styles.bar}>
              <Button icon="smartphone" onPress={() => setOpen(true)}>
                {strings.preview}
              </Button>
            </div>
          )}
          <div className={styles.body} data-preview={hasPreview || undefined}>
            <div
              className={styles.main}
              data-layout={bodyLayout}
              data-width={bodyWidth === 'form' ? 'form' : undefined}
            >
              {/* The body's Cards are the page's sections, h2 beside the Preview heading, under the TopBar's h1. */}
              <CardTitleLevel value={2}>{children}</CardTitleLevel>
              {footer !== undefined && footer !== null && footer !== false && (
                <div className={styles.footer}>{footer}</div>
              )}
            </div>
            {hasPreview && (
              <aside className={styles.side} aria-labelledby={headingId}>
                <PhoneColumn place="side" headingId={headingId} controls={previewControls} note={previewNote}>
                  {preview}
                </PhoneColumn>
              </aside>
            )}
          </div>
        </div>
      </div>
      {hasPreview && (
        // A sheet from the window's foot, as a phone's card for one thing on the page (Modal's `sheet`).
        <Modal title={strings.preview} variant="sheet" isOpen={isOpen} onOpenChange={setOpen}>
          {isOpen && (
            // The sheet's bar holds Close alone: the column's own heading names what it shows.
            <PhoneColumn place="sheet" controls={previewControls} note={previewNote}>
              {preview}
            </PhoneColumn>
          )}
        </Modal>
      )}
    </div>
  );
}
