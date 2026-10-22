import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import styles from './PreviewLayout.module.css';
import { strings } from './strings.ts';

/** The widths a page preview lays the page out at. */
export type PreviewDevice = 'phone' | 'tablet' | 'desktop';

/** The width, in CSS pixels, each device lays the page out at. */
const DEVICE_WIDTHS: Readonly<Record<PreviewDevice, number>> = { phone: 390, tablet: 768, desktop: 1280 };

/** Props for PreviewLayout. */
export interface PreviewLayoutProps {
  /** The editor's groups: Cards of Fields, a list, a table. */
  readonly children: ReactNode;
  /** Above the body, full width: a read only note, a refused publish's Callout, a teammate's change. */
  readonly notices?: ReactNode;
  /**
   * What the editor shows itself as: a `PreviewFrame` (a page in a frame) or a
   * drawn preview (`HostedFormPreview`). Sticky in a column the panel's width
   * beside the body, or under the body in "Show preview" when they don't both
   * fit. Leave it out on a tab with nothing to preview.
   */
  readonly preview?: ReactNode;
  /**
   * The preview's controls, at the end of its header row beside its "Preview" heading (`PreviewDeviceSwitch`,
   * a form's look Selects with hidden labels and `size="sm"`, their values saying what they set).
   */
  readonly previewControls?: ReactNode;
  /** Between the controls and the preview, when what it shows needs a word ("This page is off"). */
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
   * `form` holds the body's fields to `size-column-max` from the start edge, so a Select sits near its label on a
   * wide view; `columns` sets the fields in as many columns as fit across the whole width, each at least the wide
   * panel's width, so a wide view is used without stretching one input across it (the booking page editor's tabs,
   * the owner, 22 October 2026: every page full width); `full` (the default) takes the column's width.
   */
  readonly bodyWidth?: 'full' | 'form' | 'columns';
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

/** The Phone, Tablet and Desktop switch for a `PreviewFrame`, for `previewControls`. */
export function PreviewDeviceSwitch({
  value,
  onChange,
}: {
  readonly value: PreviewDevice;
  readonly onChange: (device: PreviewDevice) => void;
}) {
  return (
    <SegmentedControl
      label={strings.width}
      segments={[
        { value: 'phone', label: strings.phone },
        { value: 'tablet', label: strings.tablet },
        { value: 'desktop', label: strings.desktop },
      ]}
      value={value}
      onChange={(next) => {
        if (next === 'phone' || next === 'tablet' || next === 'desktop') onChange(next);
      }}
    />
  );
}

/** Props for PreviewFrame. */
export interface PreviewFrameProps {
  /** The page previewed: its address, loaded in a frame, and what it is. */
  readonly src: string;
  readonly title: string;
  /** The width the page is laid out at. */
  readonly device: PreviewDevice;
  /** Changes when what the preview shows was saved, so the frame loads it again. */
  readonly version?: string;
  /**
   * What the editor holds now, posted to the frame (same origin only) whenever
   * it changes and once the frame loads, so the page can show unsaved edits.
   */
  readonly draft?: unknown;
}

/** The scale that fits a device's width into the space the preview has (never above 1). */
function useFit(device: PreviewDevice) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const deviceWidth = DEVICE_WIDTHS[device];
  const scale = width === 0 ? 1 : Math.min(1, width / deviceWidth);
  return { ref, deviceWidth, scale };
}

/**
 * A page in a frame, laid out at its device's width and scaled down to fit
 * the preview column, so nothing scrolls sideways. The page is to look at:
 * the frame is inert and out of the tab order, so pressing in it never books.
 */
export function PreviewFrame({ src, title, device, version, draft }: PreviewFrameProps) {
  const { ref, deviceWidth, scale } = useFit(device);
  const frame = useRef<HTMLIFrameElement>(null);
  const post = () => {
    if (draft === undefined) return;
    frame.current?.contentWindow?.postMessage({ type: 'crm:preview', draft }, globalThis.location.origin);
  };
  useEffect(post);
  return (
    <div
      ref={ref}
      className={styles.viewport}
      // A picture of the page, not a second copy to use: nothing in it takes focus or a press.
      inert
      style={{ '--device-width': `${String(deviceWidth)}px`, '--preview-scale': String(scale) }}
    >
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

/**
 * Every Captures editor's body under its TopBar (the booking page editor, the
 * form editor): the Tabs edge to edge under the TopBar, as on Captures, then
 * any notices and the body at the page gutter (space-24, PageColumn's)
 * beside a sticky preview column the panel's width. When the layout's own
 * width can't hold both (a container query), the column hides and the
 * preview waits under the body in a "Show preview" Disclosure. `footer` pins
 * the SaveBar to the body's foot.
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
  // The narrow preview is drawn only while open, so its page loads on demand.
  const [isOpen, setOpen] = useState(false);
  const hasPreview = preview !== undefined && preview !== null;
  const headingId = useId();
  // Beside the body, the column's header row names it, with the controls at its end, level with the body's
  // first header. Under the body, in "Show preview", the Disclosure already names it: the controls sit alone.
  const column = (isBeside: boolean) =>
    hasPreview && (
      <div className={styles.preview}>
        {(isBeside || previewControls !== undefined) && (
          <div className={styles.head}>
            {isBeside && (
              <h2 className={styles.heading} id={headingId}>
                {strings.preview}
              </h2>
            )}
            {previewControls !== undefined && <div className={styles.controls}>{previewControls}</div>}
          </div>
        )}
        {previewNote}
        <div className={styles.frame}>{preview}</div>
      </div>
    );
  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        {notices}
        <div className={styles.measure}>
          <div className={styles.body} data-preview={hasPreview || undefined}>
            <div
              className={styles.main}
              data-layout={bodyLayout}
              data-width={bodyWidth === 'form' ? 'form' : undefined}
            >
              {bodyWidth === 'columns' ? <div className={styles.columns}>{children}</div> : children}
              {footer !== undefined && footer !== null && footer !== false && (
                <div className={styles.footer}>{footer}</div>
              )}
            </div>
            {hasPreview && (
              <aside className={styles.side} aria-labelledby={headingId}>
                {column(true)}
              </aside>
            )}
          </div>
          {hasPreview && (
            <div className={styles.below}>
              <Disclosure title={strings.showPreview} isExpanded={isOpen} onExpandedChange={setOpen}>
                {isOpen ? column(false) : null}
              </Disclosure>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
