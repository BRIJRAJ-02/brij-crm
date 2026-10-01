import type { FileValue } from '@crm/contracts/values';
import { FileDrop } from '../../molecules/FileDrop/FileDrop.tsx';
import { FileItem } from '../../molecules/FileItem/FileItem.tsx';
import type { EditorProps } from '../types.ts';
import { asList, toCommittable } from '../values.ts';
import styles from './FileEditor.module.css';
import { strings } from './strings.ts';

/** File: a FileDrop that hands files to `onUpload` (#32 stores them), and the attached files with remove. */
export function FileEditor({ attribute, value, onCommit, onUpload }: EditorProps<'file'>) {
  const files = asList<FileValue>(value);
  return (
    <div className={styles.root}>
      {files.map((file) => (
        <FileItem
          key={file.fileId}
          name={file.name}
          size={file.size}
          contentType={file.contentType}
          onRemove={() => {
            const rest = files.filter((item) => item.fileId !== file.fileId);
            const result = toCommittable<'file'>(attribute, attribute.allowMultiple ? rest : null);
            if (result.ok) onCommit(result.value);
          }}
        />
      ))}
      {(attribute.allowMultiple || files.length === 0) && (
        <FileDrop
          label={strings.upload(attribute.name)}
          allowsMultiple={attribute.allowMultiple}
          isDisabled={onUpload === undefined}
          onFiles={(dropped) => onUpload?.(dropped)}
        />
      )}
    </div>
  );
}
