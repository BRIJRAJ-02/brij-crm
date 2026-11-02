import { useRef, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { FileIcon } from '../../atoms/FileIcon/FileIcon.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import { ProgressBar } from '../../atoms/ProgressBar/ProgressBar.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { collapseAway } from '../../lib/motion/motion.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './FileItem.module.css';
import { strings } from './strings.ts';

/** Props for FileItem. */
export interface FileItemProps {
  readonly name: string;
  /** In bytes. */
  readonly size: number;
  readonly contentType: string;
  /** From 0 to 100 while it uploads. */
  readonly progress?: number;
  /** Why the upload failed, as a sentence that says what to do. */
  readonly error?: string;
  /**
   * Its download link, from #32. It always opens in a new tab: the api answers a file (an image to look at, or a
   * download), never an app page, so the router must not take the click.
   */
  readonly href?: string;
  /** Who added it and when (a name and a RelativeTime), after its size; a record's Files tab. */
  readonly detail?: ReactNode;
  /** Shows a remove button. The row closes up first, so the rows below glide into its place as it goes. */
  readonly onRemove?: () => void;
  /** `row` (the default) with its size and progress; `chip`, a 20px chip with the icon and name, for cells and cards. */
  readonly variant?: 'row' | 'chip';
}

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/** A size in the largest whole unit, in the language: "2.4 MB". */
export function formatFileSize(bytes: number, locale: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[unit] ?? 'byte',
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

/** One file in a list: its type icon, name and size, upload progress or its error, and remove. */
export function FileItem({
  name,
  size,
  contentType,
  progress,
  error,
  href,
  detail,
  onRemove,
  variant = 'row',
}: FileItemProps) {
  const { locale } = useFormatSettings();
  const root = useRef<HTMLDivElement>(null);
  // One press closes the row up; a second while it closes would remove it twice.
  const isLeaving = useRef(false);
  if (variant === 'chip') {
    return (
      <span className={styles.root} data-variant="chip">
        <FileIcon contentType={contentType} size="xs" />
        <span className={styles.name}>
          {href === undefined ? (
            name
          ) : (
            <Link href={href} opensInNewTab>
              {name}
            </Link>
          )}
        </span>
      </span>
    );
  }
  const isUploading = progress !== undefined && progress < 100 && error === undefined;
  return (
    <div
      ref={root}
      className={styles.root}
      data-state={error === undefined ? (isUploading ? 'uploading' : 'done') : 'failed'}
    >
      <FileIcon contentType={contentType} />
      <span className={styles.text}>
        <span className={styles.name}>
          {href === undefined ? (
            name
          ) : (
            <Link href={href} opensInNewTab>
              {name}
            </Link>
          )}
        </span>
        {error === undefined ? (
          isUploading ? (
            <ProgressBar label={strings.uploading(name)} value={progress} isLabelHidden />
          ) : (
            <span className={styles.size}>
              {formatFileSize(size, locale)}
              {detail !== undefined && (
                <>
                  {strings.separator}
                  {detail}
                </>
              )}
            </span>
          )
        ) : (
          <span className={styles.error}>{error}</span>
        )}
      </span>
      {onRemove !== undefined && (
        <Button
          variant="ghost"
          icon="x"
          label={strings.remove(name)}
          onPress={() => {
            if (isLeaving.current) return;
            isLeaving.current = true;
            // The row closes up as it goes, so the list below glides rather than jumping. Focus follows on to the
            // next row's remove, since the button pressed leaves with the row.
            collapseAway(root.current, () => {
              const next = root.current?.nextElementSibling ?? root.current?.previousElementSibling;
              onRemove();
              isLeaving.current = false;
              focusLater(() => next?.querySelector<HTMLElement>('button'));
            });
          }}
        />
      )}
    </div>
  );
}
