import { FORM_UPLOAD_ACCEPT, FORM_UPLOAD_MAX_BYTES, type FormStrings } from '@crm/contracts/forms';
import { useEffect, useRef, useState } from 'react';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { FieldGroup } from '../molecules/FieldGroup/FieldGroup.tsx';
import { FileDrop } from '../molecules/FileDrop/FileDrop.tsx';
import { FileItem } from '../molecules/FileItem/FileItem.tsx';
import { isUploadedFile, type HostedFileHandlers, type HostedUploadedFile } from './files.ts';

/** Props for FileQuestion. */
export interface FileQuestionProps {
  /** The question's key: what the form marks busy while a file goes. */
  readonly questionKey: string;
  /** The question's label, with its "(optional)" aside when it has one. */
  readonly label: string;
  readonly words: FormStrings;
  /** The file held as the answer, once it is in. */
  readonly value: unknown;
  readonly error: string | undefined;
  /** Absent (the builder's preview, a page with nowhere to send): the drop area is drawn and disabled. */
  readonly files: HostedFileHandlers | undefined;
  readonly onChange: (value: HostedUploadedFile | undefined) => void;
}

/** A file on its way, or one that didn't make it. */
interface Pending {
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  readonly progress: number;
  readonly error?: string;
}

/**
 * A hosted form's file question: a drop area and browse button that send the file as it is chosen, a row with its
 * progress, then the file with Remove. A failure shows on the row with what to do, and the drop area stays for
 * another try. One file; choosing another replaces nothing until the first is removed. Everything is a button or a
 * link a keyboard reaches, focus moves to the file's Remove when it lands and back to the browse button when it is
 * removed, and what happened is said politely.
 */
export function FileQuestion({ questionKey, label, words, value, error, files, onChange }: FileQuestionProps) {
  const held = isUploadedFile(value) ? value : undefined;
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [said, setSaid] = useState('');
  const box = useRef<HTMLDivElement>(null);
  // What to focus after the next render: the new file's Remove, or the browse button after a removal.
  const focusNext = useRef<'file' | 'browse' | undefined>(undefined);
  useEffect(() => {
    if (focusNext.current === undefined) return;
    const target = focusNext.current === 'file' ? 'button[aria-label]' : 'button';
    const control = box.current?.querySelector<HTMLElement>(target);
    focusNext.current = undefined;
    control?.focus();
  });
  const isGoing = pending !== undefined && pending.error === undefined;
  const send = (list: readonly File[]) => {
    const file = list[0];
    if (file === undefined || files === undefined || isGoing) return;
    const start: Pending = { name: file.name, size: file.size, contentType: file.type, progress: 0 };
    setPending(start);
    onChange(undefined);
    files.setBusy(questionKey, true);
    void files
      .upload(file, (percent) => {
        setPending((current) => (current === undefined ? current : { ...current, progress: percent }));
      })
      .then((outcome) => {
        files.setBusy(questionKey, false);
        if (outcome.kind === 'done') {
          setPending(undefined);
          focusNext.current = 'file';
          setSaid(words.fileUploaded(outcome.file.name));
          onChange(outcome.file);
          return;
        }
        const message =
          outcome.kind === 'rejected'
            ? outcome.message
            : outcome.kind === 'limited'
              ? words.tooMany
              : outcome.kind === 'offline'
                ? words.offline
                : words.fileFailed;
        setPending({ ...start, progress: 0, error: message });
        setSaid(message);
      });
  };
  return (
    <FieldGroup label={label} {...(error === undefined ? {} : { error })}>
      <div ref={box} data-question-files={questionKey}>
        {held !== undefined && (
          <FileItem
            name={held.name}
            size={held.size}
            contentType={held.contentType}
            onRemove={() => {
              focusNext.current = 'browse';
              setSaid(words.fileRemoved(held.name));
              onChange(undefined);
              void files?.remove(held.fileId);
            }}
          />
        )}
        {pending !== undefined && (
          <FileItem
            name={pending.name}
            size={pending.size}
            contentType={pending.contentType}
            progress={pending.progress}
            {...(pending.error === undefined
              ? {}
              : {
                  error: pending.error,
                  onRemove: () => {
                    focusNext.current = 'browse';
                    setPending(undefined);
                  },
                })}
          />
        )}
        {held === undefined && !isGoing && (
          <FileDrop
            label={words.fileChoose}
            acceptedTypes={FORM_UPLOAD_ACCEPT}
            maxSize={FORM_UPLOAD_MAX_BYTES}
            isDisabled={files === undefined}
            onFiles={send}
          />
        )}
      </div>
      <VisuallyHidden>
        <span aria-live="polite">{said}</span>
      </VisuallyHidden>
    </FieldGroup>
  );
}
