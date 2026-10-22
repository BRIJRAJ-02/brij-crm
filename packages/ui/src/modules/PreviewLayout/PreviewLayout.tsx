import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
   * label on a wide view (the booking page editor's tabs); `full` (the default) takes the column's width.
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

/**
 * A page in a frame, filling the phone PreviewLayout draws it in. The page is to look at: the frame is inert and
 * out of the tab order, so pressing in it never books.
 */
export function PreviewFrame({ src, title, version, draft }: PreviewFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const post = () => {
    if (draft === undefined) return;
    frame.current?.contentWindow?.postMessage({ type: 'crm:preview', draft }, globalThis.location.origin);
  };
  useEffect(post);
  return (
    // A picture of the page, not a second copy to use: nothing in it takes focus or a press.
    <div className={styles.viewport} inert>
      <iframe
        key={version ?? ''}
        ref={frame}
        className={styles.iframe}
        src={src}
        title={strings.previewOf(title)}
        tabIndex={-1}
        loading="lazy"
        onLoad={post}
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
