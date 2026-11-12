import { DropZone, FileTrigger, Text, ProgressBar, Button as AriaButton, type DropItem, type FileDropItem } from 'react-aria-components';
import { useState, type ReactNode } from 'react';
import { Upload, File, FileText, FileImage, FileSpreadsheet, FileArchive, FileVideo, FileAudio, X, RotateCw, CircleAlert } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { formatBytes } from '../../lib/format.ts';
import { Button } from '../Button/Button.tsx';
import './FileDrop.css';

/** Props for FileDrop. */
export interface FileDropProps {
  /** The zone's title ("Drop files here or choose them"). */
  readonly label?: string;
  /** The types and size it takes, said plainly ("PDF, PNG or JPG, up to 10 MB"). */
  readonly description?: string;
  /** MIME types or extensions the picker offers ("application/pdf", "image/*"). */
  readonly acceptedFileTypes?: readonly string[];
  readonly allowsMultiple?: boolean;
  /** Called with the dropped or chosen files; checking type and size is the caller's, so it can show error rows. */
  readonly onFiles: (files: readonly File[]) => void;
  readonly isDisabled?: boolean;
  /** `zone` the dashed area; `compact` a one line zone for a record panel. */
  readonly variant?: 'zone' | 'compact';
}

/** A dashed area that takes dropped files, with a button to choose them. Turns accent with a soft wash while files are over it. */
export function FileDrop({ label = 'Drop files here', description, acceptedFileTypes, allowsMultiple = true, onFiles, isDisabled = false, variant = 'zone' }: FileDropProps) {
  const take = async (items: readonly DropItem[]) => {
    const files = await Promise.all(items.filter((i): i is FileDropItem => i.kind === 'file').map((i) => i.getFile()));
    if (files.length) onFiles(allowsMultiple ? files : files.slice(0, 1));
  };
  return (
    <DropZone
      className={cx('tf-drop', `tf-drop--${variant}`)}
      isDisabled={isDisabled}
      getDropOperation={() => (isDisabled ? 'cancel' : 'copy')}
      onDrop={(e) => void take(e.items)}
    >
      <span className="tf-drop__icon" aria-hidden="true"><Upload size={variant === 'zone' ? 20 : 16} strokeWidth={1.75} /></span>
      <span className="tf-drop__text">
        <Text slot="label" className="tf-drop__label">{label}</Text>
        {description && <span className="tf-drop__desc">{description}</span>}
      </span>
      <FileTrigger acceptedFileTypes={acceptedFileTypes ? [...acceptedFileTypes] : undefined} allowsMultiple={allowsMultiple} onSelect={(list) => { if (list) onFiles(Array.from(list)); }}>
        <Button size="sm" variant="secondary" isDisabled={isDisabled}>Choose {allowsMultiple ? 'files' : 'a file'}</Button>
      </FileTrigger>
    </DropZone>
  );
}

/** The Lucide icon for a file's type. */
export function FileIcon({ type, name, size = 16 }: { readonly type: string; readonly name: string; readonly size?: number }) {
  const p = { size, strokeWidth: 1.75, 'aria-hidden': true } as const;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return <FileImage {...p} />;
  if (type.startsWith('video/')) return <FileVideo {...p} />;
  if (type.startsWith('audio/')) return <FileAudio {...p} />;
  if (/sheet|excel|csv/.test(type) || ['csv', 'xlsx', 'xls'].includes(ext)) return <FileSpreadsheet {...p} />;
  if (/zip|compressed|tar/.test(type) || ['zip', 'gz'].includes(ext)) return <FileArchive {...p} />;
  if (type === 'application/pdf' || /text|word|document/.test(type) || ['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return <FileText {...p} />;
  return <File {...p} />;
}

/** Props for FileRow. */
export interface FileRowProps {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  /** 0–100 while uploading; leave out once done. */
  readonly progress?: number;
  /** Why it failed, as a sentence ("Too large. Files can be up to 10 MB."). */
  readonly error?: string;
  /** Called after the row has collapsed. */
  readonly onRemove?: () => void;
  readonly onRetry?: () => void;
  /** Extra detail after the size on a finished row ("Uploaded by Sam Kim"). */
  readonly detail?: ReactNode;
}

/** One file in a list: type icon, name, size or progress, and remove. New rows drop in; a removed row collapses out. */
export function FileRow({ name, size, type, progress, error, onRemove, onRetry, detail }: FileRowProps) {
  const [leaving, setLeaving] = useState(false);
  const remove = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) onRemove?.();
    else setLeaving(true);
  };
  const uploading = progress !== undefined && !error;
  return (
    <li className="tf-file" data-leaving={leaving || undefined} data-error={error ? '' : undefined} onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onRemove?.(); }}>
      <div className="tf-file__inner">
        <span className="tf-file__icon">{error ? <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" /> : <FileIcon type={type} name={name} />}</span>
        <span className="tf-file__body">
          <span className="tf-file__name" title={name}>{name}</span>
          {error ? (
            <span className="tf-file__error" role="alert">{error}</span>
          ) : uploading ? (
            <ProgressBar className="tf-file__progress" value={progress} aria-label={`Uploading ${name}`}>
              {({ percentage }) => (
                <>
                  <span className="tf-file__bar"><span className="tf-file__fill" style={{ width: `${percentage ?? 0}%` }} /></span>
                  <span className="tf-file__meta tf-num">{Math.round(percentage ?? 0)}%</span>
                </>
              )}
            </ProgressBar>
          ) : (
            <span className="tf-file__meta">{formatBytes(size)}{detail && <> · {detail}</>}</span>
          )}
        </span>
        <span className="tf-file__actions">
          {error && onRetry && (
            <AriaButton className="tf-file__btn" aria-label={`Try ${name} again`} onPress={onRetry}><RotateCw size={14} strokeWidth={1.75} /></AriaButton>
          )}
          {onRemove && (
            <AriaButton className="tf-file__btn" aria-label={uploading ? `Cancel ${name}` : `Remove ${name}`} onPress={remove}><X size={14} strokeWidth={1.75} /></AriaButton>
          )}
        </span>
      </div>
    </li>
  );
}

/** The list FileRows sit in, newest first. */
export function FileList({ children, label = 'Files' }: { readonly children: ReactNode; readonly label?: string }) {
  return <ul className="tf-files" aria-label={label}>{children}</ul>;
}
