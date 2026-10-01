import { useState } from 'react';
import { Button as AriaButton, DropZone, FileTrigger, Text } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { formatFileSize } from '../FileItem/FileItem.tsx';
import styles from './FileDrop.module.css';
import { strings } from './strings.ts';

/** Props for FileDrop. */
export interface FileDropProps {
  /** What it takes ("Upload a CSV"). */
  readonly label: string;
  /** MIME types or extensions it accepts (`text/csv`, `.xlsx`). Leave it out to take any file. */
  readonly acceptedTypes?: readonly string[];
  /** The largest file it takes, in bytes. */
  readonly maxSize?: number;
  readonly allowsMultiple?: boolean;
  /** Called with the files that passed the checks. */
  readonly onFiles: (files: readonly File[]) => void;
  readonly isDisabled?: boolean;
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
  maxSize,
  allowsMultiple = false,
  onFiles,
  isDisabled = false,
}: FileDropProps) {
  const { locale } = useFormatSettings();
  const [error, setError] = useState<string | undefined>(undefined);
  const take = (files: readonly File[]) => {
    const wrongType = files.find((file) => !accepts(file, acceptedTypes));
    if (wrongType !== undefined) {
      setError(strings.wrongType(wrongType.name, (acceptedTypes ?? []).join(', ')));
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
  const limits = [
    acceptedTypes === undefined ? undefined : acceptedTypes.join(', '),
    maxSize === undefined ? undefined : strings.upTo(formatFileSize(maxSize, locale)),
  ].filter((part) => part !== undefined);
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
        <Icon name="upload" size="md" tone="muted" />
        <Text slot="label" className={styles.label}>
          {label}
        </Text>
        <span className={styles.hint}>
          {strings.dragOr}{' '}
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
      {error !== undefined && (
        <span className={styles.error} role="alert">
          <Icon name="circle-alert" size="xs" />
          {error}
        </span>
      )}
    </div>
  );
}
