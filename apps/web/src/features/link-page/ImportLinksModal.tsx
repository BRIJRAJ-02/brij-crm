// Brief
// Purpose: bring the rows of somebody's existing link in bio page across (spec 0055, AC-5524 to AC-5528), so a
// person moving here doesn't retype forty links.
// Main task: paste the old page's address, and see what came across and what didn't.
// Leaves out: choosing which rows to bring before they land. Everything lands hidden, so the choosing happens on
// the page itself with the switch that was already there, and a person who imports and walks away publishes
// nothing. Loaded with the editor's chunk, never the first load.
import { Button, EmptyState, Field, Modal } from '@crm/ui';
import type { DataError, ProfileLinkImport, SkippedImportRow } from '@crm/data';
import { useState } from 'react';
import { importStrings as strings } from './import-strings.ts';

/** Props for the import modal. */
export interface ImportLinksModalProps {
  /** Kept mounted while it closes, so the Modal's own exit plays. */
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Reads the page and lands its rows hidden. Rejects with the refusal, which is shown on the field. */
  readonly onImport: (url: string) => Promise<ProfileLinkImport>;
}

/** A row we can word: the row itself and why it stayed behind, in a sentence. */
interface SkippedShown {
  readonly title?: string;
  readonly url?: string;
  readonly reason: string;
}

/**
 * Bring a page across: one address in, and a plain account of what happened. Two steps in one modal, because
 * the second is the answer to the first and a person reading it has nothing left to decide.
 */
export function ImportLinksModal({ isOpen, onClose, onImport }: ImportLinksModalProps) {
  const [url, setUrl] = useState('');
  const [isReading, setReading] = useState(false);
  const [refusal, setRefusal] = useState<DataError | undefined>(undefined);
  const [made, setMade] = useState<ProfileLinkImport | undefined>(undefined);

  const bring = () => {
    if (isReading || url.trim() === '') return;
    setReading(true);
    setRefusal(undefined);
    onImport(url.trim())
      .then(setMade)
      .catch((error: unknown) => setRefusal(error as DataError))
      .finally(() => setReading(false));
  };
  const close = () => {
    if (isReading) return;
    onClose();
  };
  // A reason this version has no words for is left out rather than shown raw: the count below says how many
  // rows stayed behind either way.
  const skipped: readonly SkippedShown[] =
    made?.skipped.flatMap((row: SkippedImportRow) => {
      const reason = strings.reasons[row.reason] as string | undefined;
      return reason === undefined ? [] : [{ ...row, reason }];
    }) ?? [];

  return (
    <Modal
      title={made === undefined ? strings.title : strings.doneTitle}
      isOpen={isOpen}
      isBusy={isReading}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      actions={
        made === undefined ? (
          <>
            <Button onPress={close}>{strings.cancel}</Button>
            <Button variant="primary" icon="download" isPending={isReading} onPress={bring}>
              {strings.bring}
            </Button>
          </>
        ) : (
          <Button variant="primary" onPress={close}>
            {strings.done}
          </Button>
        )
      }
    >
      {made === undefined ? (
        <>
          <p>{strings.lead}</p>
          <Field
            label={strings.address}
            placeholder={strings.example}
            hint={strings.services}
            value={url}
            // The modal opens to be given one address: its only field is what the press asked for.
            // eslint-disable-next-line jsx-a11y-x/no-autofocus
            autoFocus
            onChange={setUrl}
            onSubmit={bring}
            {...(refusal === undefined ? {} : { error: refusal.message })}
          />
        </>
      ) : (
        <>
          <p>{made.existed ? strings.alreadyDone : strings.madeLine(made.made)}</p>
          {made.made > 0 && <p>{strings.hiddenNote}</p>}
          {made.made === 0 && !made.existed && (
            <EmptyState title={strings.nothingTitle}>{strings.nothingText}</EmptyState>
          )}
          {skipped.length > 0 && (
            <>
              <p>{strings.skippedLine(skipped.length)}</p>
              <ul>
                {skipped.map((row, index) => (
                  <li key={`${row.url ?? ''}-${String(index)}`}>
                    {`${row.title ?? row.url ?? strings.unnamed} — ${row.reason}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
