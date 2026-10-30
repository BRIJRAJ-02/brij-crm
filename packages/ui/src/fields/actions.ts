// One way to create inline (the field polish pass, 30 Oct 2026): a screen says
// once, through FieldActionsContext, how it makes an option, a record or an
// upload, and every editor under it offers "Create "<typed>"" the same way,
// whether it sits in the grid, a record's details, a create dialog or a bulk
// edit. Before, only the grid threaded the prop down, so the same select
// offered Create in a cell and not on the record page.
import { createContext, useContext } from 'react';
import type { RecordRefDisplay } from '@crm/contracts/values';
import type { FieldAttribute } from './types.ts';

/** What a screen lets its editors make. Each is absent where the viewer may not make that thing. */
export interface FieldActions {
  /** A new option on a select or status attribute, named by what was typed; the screen sets it on the value. */
  readonly createOption?: (attribute: FieldAttribute, label: string) => void;
  /** A new record of a reference's far object, named by what was typed: its display, picked at once. */
  readonly createRecord?: (attribute: FieldAttribute, label: string) => RecordRefDisplay | undefined;
  /** Files for a file attribute, dropped, picked or pasted. */
  readonly upload?: (attribute: FieldAttribute, files: readonly File[]) => void;
}

/** The screen's field actions; AttributeEditor reads it for any editor whose own props don't say. */
export const FieldActionsContext = createContext<FieldActions | undefined>(undefined);

/** The screen's field actions, if it gave any. */
export function useFieldActions(): FieldActions | undefined {
  return useContext(FieldActionsContext);
}
