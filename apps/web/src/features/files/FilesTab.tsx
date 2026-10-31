// Brief
// Purpose: the files that belong to this record (a proposal, a contract, a photo), on its Files tab.
// Main task: drop or pick files to add them, then open, download or delete one (Undo brings it back).
// Leaves out: folders, previews of documents, versions, files over 4 MB, and the files a field holds (they stay in it).
import { opensInline, RECORD_FILE_ACCEPT, RECORD_FILE_MAX_BYTES } from '@crm/data';
import type { MemberSummary, RecordFilesSource, RecordFileView } from '@crm/data';
import { useRecordFiles } from '@crm/data/react';
import { EmptyState, FileDrop, FileItem, RelativeTime, Skeleton, VisuallyHidden } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { UNDO_MS } from '../tasks/undo-delete.ts';
import { strings } from './strings.ts';

/** Props for a record's Files tab. */
export interface FilesTabProps {
  readonly slug: string;
  readonly recordId: string;
  readonly files: RecordFilesSource;
  readonly members: readonly MemberSummary[];
  /** The record is in the trash or lost: files list and download, with nothing to add or delete. */
  readonly isReadOnly: boolean;
}

/** Three rows' worth of skeleton while the files load; the record page's pending tab too. */
export function LoadingFiles() {
  return (
    <>
      <VisuallyHidden>{strings.loadingFiles}</VisuallyHidden>
      <Skeleton lines={1} />
      <Skeleton lines={1} />
      <Skeleton lines={1} />
    </>
  );
}

/**
 * A record's Files tab (#32): the drop zone for someone who may change the record, the files on their way with
 * their progress (or why they were refused), then the record's files newest first. A file's name opens it: an image
 * in a new tab, anything else downloads. Delete is one click, with Undo.
 */
export function FilesTab({ slug, recordId, files, members, isReadOnly }: FilesTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const state = useRecordFiles(files);
  if (state.status === 'unavailable') return <EmptyState icon="file" title={strings.unavailable} />;
  if (state.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.loadFailed} onRetry={files.retry}>
        {strings.loadFailedText}
      </EmptyState>
    );
  }
  if (state.status === 'loading') return <LoadingFiles />;
  const canChange = state.canChange && !isReadOnly;
  const nameOf = (memberId: string) => members.find((member) => member.id === memberId)?.name ?? strings.formerMember;
  const remove = (file: RecordFileView) => {
    const removing = data.files.remove(slug, recordId, file.fileId);
    const key = toasts.toast(
      {
        tone: 'success',
        message: strings.deleted(file.name),
        action: {
          label: strings.undo,
          // Undo after the delete landed, so the restore never races it.
          onAction: () => {
            void removing.then((landed) => (landed ? data.files.restore(slug, recordId, file) : undefined));
          },
        },
      },
      { timeout: UNDO_MS },
    );
    // A refused delete puts the file back with its own toast; this one goes.
    void removing.then((landed) => {
      if (!landed) toasts.dismiss(key);
    });
  };
  return (
    <>
      {canChange && (
        <FileDrop
          label={strings.addFiles}
          acceptedTypes={RECORD_FILE_ACCEPT}
          maxSize={RECORD_FILE_MAX_BYTES}
          allowsMultiple
          onFiles={(picked) => {
            void data.files.upload(slug, recordId, picked);
          }}
        />
      )}
      {state.sending.map((sending) => (
        <FileItem
          key={sending.key}
          name={sending.name}
          size={sending.size}
          contentType={sending.contentType}
          progress={sending.progress}
          {...(sending.error === undefined
            ? {}
            : {
                error: sending.error,
                onRemove: () => {
                  void data.files.dismiss(slug, recordId, sending.key);
                },
              })}
        />
      ))}
      {state.files.length === 0 && state.sending.length === 0 && !canChange && (
        <EmptyState icon="file" title={strings.noFiles} />
      )}
      {state.files.map((file) => (
        <FileItem
          key={file.fileId}
          name={file.name}
          size={file.size}
          contentType={file.contentType}
          href={data.files.downloadPath(slug, file.fileId, opensInline(file.contentType))}
          detail={
            <>
              {file.createdByMemberId === undefined ? undefined : strings.addedBy(nameOf(file.createdByMemberId))}
              <RelativeTime value={file.createdAt} />
            </>
          }
          {...(canChange
            ? {
                onRemove: () => {
                  remove(file);
                },
              }
            : {})}
        />
      ))}
    </>
  );
}
