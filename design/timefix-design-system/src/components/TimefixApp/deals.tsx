// Why a deal was lost: asked once, the moment it moves to Lost, from wherever it moved (table, board, record, bulk).
import { useState } from 'react';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Button } from '../Button/Button.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { TextArea } from '../Field/Field.tsx';

/** The reasons a deal is lost, in the words sales teams use (Pipedrive's and HubSpot's defaults, trimmed). */
export const LOST_REASONS = ['Price', 'Went with a competitor', 'Timing', 'No decision', 'Not a fit', 'Other'] as const;

/** Asks why one or more deals were lost: one reason and an optional note, or Skip. */
export function LostReasonDialog({ names, onSave, onSkip }: { readonly names: ReadonlyArray<string>; readonly onSave: (reason: string, note: string) => void; readonly onSkip: () => void }) {
  const [reason, setReason] = useState<string>();
  const [note, setNote] = useState('');
  const many = names.length > 1;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onSkip(); }} title={many ? `Why were ${names.length} deals lost?` : 'Why was it lost?'}
      description={many ? names.join(', ') : `${names[0] ?? 'This deal'}. It helps the team see why deals slip away.`}
      actions={<><Button variant="ghost" onPress={onSkip}>Skip</Button><Button variant="primary" isDisabled={!reason} onPress={() => { if (reason) onSave(reason, note.trim()); }}>Save</Button></>}>
      <div className="tf-rec__form">
        <ChoiceChips label="Reason" selectionMode="single" size="sm" selectedKeys={reason ? [reason] : []} onSelectionChange={(k) => setReason([...k][0])} items={LOST_REASONS.map((r) => ({ id: r, label: r }))} />
        <TextArea label="Note" aside="Optional" rows={2} value={note} onChange={setNote} placeholder={reason === 'Went with a competitor' ? 'Who, and why' : 'Anything the next deal can learn from'} />
      </div>
    </Dialog>
  );
}
