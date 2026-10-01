import { Button } from '../../atoms/Button/Button.tsx';
import { FileIcon } from '../../atoms/FileIcon/FileIcon.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import { ProgressBar } from '../../atoms/ProgressBar/ProgressBar.tsx';
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
  /** Its download link, from #32. */
  readonly href?: string;
  /** Shows a remove button. */
  readonly onRemove?: () => void;
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
export function FileItem({ name, size, contentType, progress, error, href, onRemove }: FileItemProps) {
  const { locale } = useFormatSettings();
  const isUploading = progress !== undefined && progress < 100 && error === undefined;
  return (
    <div className={styles.root} data-state={error === undefined ? (isUploading ? 'uploading' : 'done') : 'failed'}>
      <FileIcon contentType={contentType} />
      <span className={styles.text}>
        <span className={styles.name}>{href === undefined ? name : <Link href={href}>{name}</Link>}</span>
        {error === undefined ? (
          isUploading ? (
            <ProgressBar label={strings.uploading(name)} value={progress} isLabelHidden />
          ) : (
            <span className={styles.size}>{formatFileSize(size, locale)}</span>
          )
        ) : (
          <span className={styles.error}>{error}</span>
        )}
      </span>
      {onRemove !== undefined && <Button variant="ghost" icon="x" label={strings.remove(name)} onPress={onRemove} />}
    </div>
  );
}
