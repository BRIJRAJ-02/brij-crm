// The toast once New record made a record (the table, the board): its name
// and Open, to its page. Kept apart from the screens, so the node tests cover
// it.
import type { RecordView } from '@crm/data';
import type { ToastContent } from '@crm/ui';
import { strings } from './strings.ts';

/**
 * How long the toast stays: a confirmation's 5 seconds, though it carries an action (which alone would keep it until
 * dismissed), since Open is a shortcut, not a question; the new row is in the table either way.
 */
export const CREATED_TOAST_MS = 5_000;

/** "Ada Lovelace created", or "Unnamed person created" with no name, with Open to its page. */
export function createdToast(record: RecordView, singularName: string, onOpen: () => void): ToastContent {
  const name = record.display.name.trim() === '' ? strings.unnamed(singularName) : record.display.name;
  return {
    tone: 'success',
    message: strings.recordCreated(name),
    action: { label: strings.openRecord, onAction: onOpen },
  };
}
