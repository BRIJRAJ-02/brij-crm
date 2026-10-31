import { useState } from 'react';
import { Button as AriaButton, DropZone, FileTrigger, Text } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { formatFileSize } from '../FileItem/FileItem.tsx';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import styles from './FileDrop.module.css';
import { strings } from './strings.ts';

/** Props for FileDrop. */
export interface FileDropProps {
  /** What it takes ("Upload a CSV"). */
  readonly label: string;
  /** MIME types or extensions it accepts (`text/csv`, `.xlsx`). Leave it out to take any file. */
  readonly acceptedTypes?: readonly string[];
  /**
   * The accepted types as people name them ("PNG, JPG or WebP"), shown in the hint and the refusal in place of the
   * raw `acceptedTypes` (`image/png, image/jpeg`). Leave it out where the raw list already reads well (`.csv`).
   */
  readonly typesText?: string;
  /** The largest file it takes, in bytes. */
  readonly maxSize?: number;
  readonly allowsMultiple?: boolean;
  /** Called with the files that passed the checks. */
  readonly onFiles: (files: readonly File[]) => void;
  /**
   * The picture that is there already, for a single file picker that replaces one (an avatar, a logo, a page's
   * share image): drawn above the label, so somebody sees what they are about to replace. It comes from our own
   * origin like every other image here (`safeImageSrc`), and goes quietly if it won't load.
   */
  readonly preview?: { readonly src: string; readonly alt: string };
  readonly isDisabled?: boolean;
  /**
   * `zone` (the default) is the drop area with its browse button. `button` is the browse button alone, with
   * `label` as its words, for a picker that sits beside what it changes (first run's avatar, 27 October 2026),
   * where a drop area would draw the picture twice. Same checks, same refusal line; nothing to drop onto.
   */
  readonly variant?: 'zone' | 'button';
  /** With `variant="button"`: what was picked is on its way, so the button spins and takes no second press. */
  readonly isPending?: boolean;
  /**
   * The screen's own refusal for a file of a type it doesn't take, when it has a better one than "Choose .csv"
   * (an Excel file: how to save it as CSV); undefined keeps the built in sentence.
   */
  readonly wrongTypeText?: (fileName: string) => string | undefined;
}

function accepts(file: File, types: readonly string[] | undefined): boolean {
  if (types === undefined || types.length === 0) return true;
  const name = file.name.toLowerCase();
  return types.some((type) => (type.startsWith('.') ? name.endsWith(type.toLowerCase()) : file.type === type));
}

/**
 * Drop files here or browse for them: an import's CSV, a record's files. It
 * says which types and sizes it takes, and refuses others with a sentence on
 * what to do. Built on React Aria's DropZone and FileTrigger, so it works by
 * keyboard and screen reader too.
 */
export function FileDrop({
  label,
  acceptedTypes,
  typesText,
  maxSize,
  allowsMultiple = false,
  onFiles,
  preview,
  isDisabled = false,
  variant = 'zone',
  isPending = false,
  wrongTypeText,
}: FileDropProps) {
  const { locale } = useFormatSettings();
  const [error, setError] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const shown = safeImageSrc(preview?.src);
  const types = typesText ?? acceptedTypes?.join(', ');
  const take = (files: readonly File[]) => {
    const wrongType = files.find((file) => !accepts(file, acceptedTypes));
    if (wrongType !== undefined) {
      setError(wrongTypeText?.(wrongType.name) ?? strings.wrongType(wrongType.name, types ?? ''));
      return;
    }
    const tooBig = maxSize === undefined ? undefined : files.find((file) => file.size > maxSize);
    if (tooBig !== undefined && maxSize !== undefined) {
      setError(strings.tooBig(tooBig.name, formatFileSize(maxSize, locale)));
      return;
    }
    setError(undefined);
    onFiles(allowsMultiple ? files : files.slice(0, 1));
  };
  const limits = [types, maxSize === undefined ? undefined : strings.upTo(formatFileSize(maxSize, locale))].filter(
    (part) => part !== undefined,
  );
  const refusal =
    error === undefined ? undefined : (
      <span className={styles.error} role="alert">
        <Icon name="circle-alert" size="xs" />
        {error}
      </span>
    );
  if (variant === 'button') {
    return (
      <div className={styles.field}>
        <FileTrigger
          allowsMultiple={allowsMultiple}
          {...(acceptedTypes === undefined ? {} : { acceptedFileTypes: [...acceptedTypes] })}
          onSelect={(list) => {
            if (list !== null) take([...list]);
          }}
        >
          <Button icon="upload" isPending={isPending} isDisabled={isDisabled}>
            {label}
          </Button>
        </FileTrigger>
        {refusal}
      </div>
    );
  }
  return (
    <div className={styles.field}>
      <DropZone
        className={styles.root}
        isDisabled={isDisabled}
        aria-label={label}
        onDrop={(event) => {
          void Promise.all(event.items.flatMap((item) => (item.kind === 'file' ? [item.getFile()] : []))).then(take);
        }}
      >
        {shown !== undefined && failed !== shown ? (
          <img
            className={styles.preview}
            src={shown}
            alt={preview?.alt ?? ''}
            onError={() => {
              setFailed(shown);
            }}
          />
        ) : (
          <Icon name="upload" size="md" tone="muted" />
        )}
        <Text slot="label" className={styles.label}>
          {label}
        </Text>
        <span className={styles.hint}>
          {allowsMultiple ? strings.dragOr : strings.dragOneOr}{' '}
          <FileTrigger
            allowsMultiple={allowsMultiple}
            {...(acceptedTypes === undefined ? {} : { acceptedFileTypes: [...acceptedTypes] })}
            onSelect={(list) => {
              if (list !== null) take([...list]);
            }}
          >
            <AriaButton className={styles.browse} isDisabled={isDisabled}>
              {strings.browse}
            </AriaButton>
          </FileTrigger>
        </span>
        {limits.length > 0 && <span className={styles.limits}>{limits.join(' · ')}</span>}
      </DropZone>
      {refusal}
    </div>
  );
}
