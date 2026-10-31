// The one way a screen opens the merge dialog (spec 0049): the record page's "Merge with…" with one record, and
// (from the duplicates lane) the duplicates page and banner with both. The screen draws `dialog` once.
import type { AttributeDefinition, MemberSummary, ObjectSummary } from '@crm/data';
import { useState, type ReactNode } from 'react';
import { MergeDialog, type MergeDialogProps } from './MergeDialog.tsx';

/** What a screen needs to open the merge dialog. */
export interface MergeDialogSetup {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  readonly onMerged?: MergeDialogProps['onMerged'];
}

/**
 * The merge dialog's launcher: `open([recordId])` asks for the other record first, `open([a, b])` shows the pair
 * (the newer merged away by default). `dialog` is the dialog to draw, closed until opened.
 */
export function useMergeDialog(setup: MergeDialogSetup): {
  readonly open: (recordIds: readonly [string] | readonly [string, string]) => void;
  readonly dialog: ReactNode;
} {
  const [recordIds, setRecordIds] = useState<readonly string[] | undefined>(undefined);
  return {
    open: (ids) => {
      setRecordIds(ids);
    },
    dialog: (
      <MergeDialog
        {...setup}
        recordIds={recordIds}
        onClose={() => {
          setRecordIds(undefined);
        }}
      />
    ),
  };
}
