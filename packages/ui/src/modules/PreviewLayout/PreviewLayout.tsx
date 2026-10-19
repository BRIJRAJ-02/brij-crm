import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import styles from './PreviewLayout.module.css';
import { strings } from './strings.ts';

/** The widths the preview shows a page at. */
export type PreviewDevice = 'phone' | 'tablet' | 'desktop';

/** The width, in CSS pixels, each device lays the page out at. */
const DEVICE_WIDTHS: Readonly<Record<PreviewDevice, number>> = { phone: 390, tablet: 768, desktop: 1280 };

/** Props for PreviewLayout. */
export interface PreviewLayoutProps {
  /** The editor's groups. */
  readonly children: ReactNode;
  /** The page previewed: its address, loaded in a frame, and what it is. */
  readonly previewSrc: string;
  readonly previewTitle: string;
  /** Changes when what the preview shows was saved, so the frame loads it again. */
  readonly previewVersion?: string;
  /**
   * What the editor holds now, posted to the frame (same origin only) whenever
   * it changes and once the frame loads, so the page can show unsaved edits.
   */
  readonly previewDraft?: unknown;
  /** Said above the frame, when what it shows needs a word ("Turn the page on to preview it"). */
  readonly previewNote?: ReactNode;
  /** A bar pinned to the editor's foot while it has something to say ("Unsaved changes", Save). */
  readonly footer?: ReactNode;
  readonly defaultDevice?: PreviewDevice;
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

/** One preview: the width switch and the page in a frame, laid out at the device's width and scaled to fit. */
function Preview({
  device,
  onDevice,
  src,
  title,
  version,
  draft,
  note,
}: {
  readonly device: PreviewDevice;
  readonly onDevice: (device: PreviewDevice) => void;
  readonly src: string;
  readonly title: string;
  readonly version: string | undefined;
  readonly draft: unknown;
  readonly note: ReactNode;
}) {
  const { ref, deviceWidth, scale } = useFit(device);
  const frame = useRef<HTMLIFrameElement>(null);
  const post = () => {
    if (draft === undefined) return;
    frame.current?.contentWindow?.postMessage({ type: 'crm:preview', draft }, globalThis.location.origin);
  };
  useEffect(post);
  return (
    <div className={styles.preview}>
      <SegmentedControl
        label={strings.width}
        segments={[
          { value: 'phone', label: strings.phone },
          { value: 'tablet', label: strings.tablet },
          { value: 'desktop', label: strings.desktop },
        ]}
        value={device}
        onChange={(value) => {
          if (value === 'phone' || value === 'tablet' || value === 'desktop') onDevice(value);
        }}
      />
      {note}
      <div
        ref={ref}
        className={styles.viewport}
        // A picture of the page, not a second copy to use: nothing in it takes focus or a press, so it never books.
        inert
        style={{ '--device-width': `${String(deviceWidth)}px`, '--preview-scale': String(scale) }}
      >
        <iframe
          key={version ?? ''}
          ref={frame}
          className={styles.frame}
          src={src}
          title={strings.previewOf(title)}
          tabIndex={-1}
          loading="lazy"
          onLoad={post}
        />
      </div>
    </div>
  );
}

/**
 * An editor beside a live preview of what it edits (spec 0025 experience, the
 * booking page editor, AC-679): the editor on the left (the wide dialog's
 * width at most), the preview sticky on the right with a Phone, Tablet and
 * Desktop switch. The frame lays the page out at that device's width and
 * scales it down to fit the column, so the layout never scrolls sideways.
 * Below the page breakpoint the preview moves under a "Show preview"
 * Disclosure. The preview is the real page in a frame, loaded again whenever
 * `previewVersion` changes and sent `previewDraft` as it changes.
 */
export function PreviewLayout({
  children,
  previewSrc,
  previewTitle,
  previewVersion,
  previewDraft,
  previewNote,
  footer,
  defaultDevice = 'phone',
}: PreviewLayoutProps) {
  const [device, setDevice] = useState<PreviewDevice>(defaultDevice);
  const preview = (
    <Preview
      device={device}
      onDevice={setDevice}
      src={previewSrc}
      title={previewTitle}
      version={previewVersion}
      draft={previewDraft}
      note={previewNote}
    />
  );
  return (
    <div className={styles.root}>
      <div className={styles.editor}>
        {children}
        {footer !== undefined && footer !== null && footer !== false && <div className={styles.footer}>{footer}</div>}
      </div>
      <aside className={styles.side} aria-label={strings.preview}>
        {preview}
      </aside>
      <div className={styles.below}>
        <Disclosure title={strings.showPreview}>{preview}</Disclosure>
      </div>
    </div>
  );
}
