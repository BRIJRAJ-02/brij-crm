// The toast once New record made a record (the table, the board): its name
// and Open, to its page. Kept apart from the screens, so the node tests cover
// it.
import type { FiledNotice, RecordView } from '@crm/data';
import type { ToastContent } from '@crm/ui';
import { createdFiledToast, FILED_TOAST_MS } from './filed.ts';
import { strings } from './strings.ts';

/**
 * How long the toast stays: a confirmation's 5 seconds, though it carries an action (which alone would keep it until
 * dismissed), since Open is a shortcut, not a question; the new row is in the table either way.
 */
export const CREATED_TOAST_MS = 5_000;

/** "Ada Lovelace created", or "Unnamed person created" with no name, with Open to its page. */
export function createdToast(record: RecordView, singularName: string, onOpen: () => void): ToastContent {
  const name = createdName(record, singularName);
  return {
    tone: 'success',
    message: strings.recordCreated(name),
    action: { label: strings.openRecord, onAction: onOpen },
  };
}

/** The record's name as its toast says it: "Unnamed person" with none. */
function createdName(record: RecordView, singularName: string): string {
  return record.display.name.trim() === '' ? strings.unnamed(singularName) : record.display.name;
}

/** A filing the create made (spec 0059), and what its Unlink runs. */
export interface CreatedFiling {
  readonly notice: FiledNotice;
  readonly onUnlink: () => void;
}

/**
 * The one toast after New record (spec 0059 follow up): "Ada Lovelace created" with Open, or, when her email filed
 * her under a company, "Ada Lovelace created and linked to Acme" with Unlink and the Unlink's 10 seconds, in place
 * of two toasts one after the other. The record is in the table either way; Unlink is the one that can't wait.
 */
export function createdToastFor(
  record: RecordView,
  singularName: string,
  onOpen: () => void,
  filing: CreatedFiling | undefined,
): { readonly content: ToastContent; readonly timeout: number } {
  return filing === undefined
    ? { content: createdToast(record, singularName, onOpen), timeout: CREATED_TOAST_MS }
    : {
        content: createdFiledToast(createdName(record, singularName), filing.notice, filing.onUnlink),
        timeout: FILED_TOAST_MS,
      };
}
