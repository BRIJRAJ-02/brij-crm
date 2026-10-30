// Brief
// Purpose: bring the rows of somebody's existing link in bio page across (spec 0055, AC-5524 to AC-5528), so a
// person moving here doesn't retype forty links.
// Main task: paste the old page's address, and see what came across and what didn't.
// Leaves out: choosing which rows to bring before they land. Everything lands hidden, so the choosing happens on
// the page itself with the switch that was already there, and a person who imports and walks away publishes
// nothing. Loaded with the editor's chunk, never the first load.
import { Button, Callout, DescriptionList, Field, focusLater, Modal } from '@crm/ui';
import type { DataError, ProfileLinkImport, SkippedImportRow } from '@crm/data';
import { useRef, useState } from 'react';
import { importStrings as strings } from './import-strings.ts';

/** Props for the import modal. */
export interface ImportLinksModalProps {
  /** Kept mounted while it closes, so the Modal's own exit plays. */
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** A fresh import id. One import is one id, so a retry of the same address adds nothing twice (AC-5528). */
  readonly newId: () => string;
  /** Reads the page and lands its rows hidden. Rejects with the refusal, which is shown on the field. */
  readonly onImport: (id: string, url: string) => Promise<ProfileLinkImport>;
}

/** The refusals that are about the address itself, which belong under the field. Anything else is not. */
const ABOUT_THE_ADDRESS: readonly string[] = ['CONFIG_INVALID', 'INPUT_INVALID'];

/**
 * Why a row stayed behind, in a sentence. Every reason the contract has is worded here, and typecheck fails if
 * one is added without words, so no row can ever be dropped from this list for want of a sentence.
 */
function reasonOf(row: SkippedImportRow): string {
  return strings.reasons[row.reason];
}

/**
 * Bring a page across: one address in, and a plain account of what happened. Two steps in one modal, because
 * the second is the answer to the first and a person reading it has nothing left to decide.
 */
export function ImportLinksModal({ isOpen, newId, onClose, onImport }: ImportLinksModalProps) {
  const [url, setUrl] = useState('');
  const [isReading, setReading] = useState(false);
  const [refusal, setRefusal] = useState<DataError | undefined>(undefined);
  const [made, setMade] = useState<ProfileLinkImport | undefined>(undefined);
  const doneRef = useRef<HTMLButtonElement>(null);
  // The id of the import on its way, with the address it was minted for. A send that failed on the way back (the
  // rows landed, the answer didn't) is tried again under the same id, so it adds nothing twice; a corrected
  // address is a different import and takes a new one, or the server would answer about a page it never read.
  const sent = useRef<{ readonly url: string; readonly id: string } | undefined>(undefined);

  const bring = () => {
    const wanted = url.trim();
    if (isReading || wanted === '') return;
    const id = sent.current?.url === wanted ? sent.current.id : newId();
    sent.current = { url: wanted, id };
    setReading(true);
    setRefusal(undefined);
    onImport(id, wanted)
      .then((answer) => {
        setMade(answer);
        // The button that was pressed goes with the step it belonged to, so focus is moved deliberately rather
        // than left to land wherever the dialog's containment drops it.
        focusLater(() => doneRef.current);
      })
      .catch((error: unknown) => setRefusal(error as DataError))
      .finally(() => setReading(false));
  };
  const close = () => {
    if (isReading) return;
    onClose();
  };
  const onTheField = refusal !== undefined && ABOUT_THE_ADDRESS.includes(refusal.code);
  const skipped = made?.skipped ?? [];

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
            <Button slot="close" isDisabled={isReading}>
              {strings.cancel}
            </Button>
            <Button variant="primary" icon="download" isPending={isReading} onPress={bring}>
              {strings.bring}
            </Button>
          </>
        ) : (
          <Button ref={doneRef} variant="primary" onPress={close}>
            {strings.done}
          </Button>
        )
      }
    >
      {made === undefined ? (
        <>
          {/* A refusal that isn't about what was typed (the page wouldn't answer, the hourly limit) belongs over
              the field rather than under it, where it would read as a mistake in the address. */}
          {refusal !== undefined && !onTheField && (
            <Callout tone="danger" isPolite>
              {refusal.message}
            </Callout>
          )}
          <p>{strings.lead}</p>
          <Field
            label={strings.address}
            placeholder={strings.example}
            hint={strings.services}
            value={url}
            isDisabled={isReading}
            // The modal opens to be given one address: its only field is what the press asked for.
            // eslint-disable-next-line jsx-a11y-x/no-autofocus
            autoFocus
            onChange={(typed) => {
              setUrl(typed);
              // The reason stops applying the moment the address changes, so it goes rather than sitting under a
              // field whose contents it is no longer about.
              setRefusal(undefined);
            }}
            onSubmit={bring}
            {...(onTheField ? { error: refusal.message } : {})}
          />
        </>
      ) : (
        <>
          <Callout tone={made.made > 0 ? 'success' : 'warning'} isAnnounced>
            {made.existed
              ? strings.alreadyDone
              : made.made === 0
                ? strings.nothingText
                : `${strings.madeLine(made.made)} ${strings.hiddenNote}`}
          </Callout>
          {skipped.length > 0 && (
            <Callout tone="warning" title={strings.skippedLine(skipped.length)}>
              <DescriptionList
                layout="stacked"
                items={skipped.map((row, index) => ({
                  id: String(index),
                  term: row.title ?? row.url ?? strings.unnamed,
                  description: reasonOf(row),
                }))}
              />
            </Callout>
          )}
        </>
      )}
    </Modal>
  );
}
