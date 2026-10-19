import { useState, type ReactNode } from 'react';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import styles from './PreviewLayout.module.css';
import { strings } from './strings.ts';

/** The widths the preview shows a page at. */
export type PreviewDevice = 'phone' | 'tablet' | 'desktop';

/** Props for PreviewLayout. */
export interface PreviewLayoutProps {
  /** The editor's groups. */
  readonly children: ReactNode;
  /** The page previewed: its address, loaded in a frame, and what it is. */
  readonly previewSrc: string;
  readonly previewTitle: string;
  /** Changes when what the preview shows was saved, so the frame loads it again. */
  readonly previewVersion?: string;
  /** A bar pinned to the editor's foot while it has something to say ("Unsaved changes", Save). */
  readonly footer?: ReactNode;
  readonly defaultDevice?: PreviewDevice;
}

/**
 * An editor beside a live preview of what it edits (spec 0025 experience, the
 * booking page editor, AC-679): the editor on the left (at most 52rem), the
 * preview sticky on the right with a Phone, Tablet and Desktop switch that
 * changes its width. Below the page breakpoint the preview moves under a
 * "Show preview" Disclosure. The preview is the real page in a frame, loaded
 * again whenever `previewVersion` changes.
 */
export function PreviewLayout({
  children,
  previewSrc,
  previewTitle,
  previewVersion,
  footer,
  defaultDevice = 'phone',
}: PreviewLayoutProps) {
  const [device, setDevice] = useState<PreviewDevice>(defaultDevice);
  const preview = (
    <div className={styles.preview} data-device={device}>
      <SegmentedControl
        label={strings.width}
        segments={[
          { value: 'phone', label: strings.phone },
          { value: 'tablet', label: strings.tablet },
          { value: 'desktop', label: strings.desktop },
        ]}
        value={device}
        onChange={(value) => {
          if (value === 'phone' || value === 'tablet' || value === 'desktop') setDevice(value);
        }}
      />
      <iframe
        key={previewVersion ?? ''}
        className={styles.frame}
        src={previewSrc}
        title={strings.previewOf(previewTitle)}
        loading="lazy"
      />
    </div>
  );
  return (
    <div className={styles.root} data-device={device}>
      <div className={styles.editor}>
        {children}
        {footer !== undefined && <div className={styles.footer}>{footer}</div>}
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
