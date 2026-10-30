// Settings' toasts: the one a job this browser started raises when it ends (spec 0008, AC-119), and the one a
// setting that saves at once raises (the owner's save rule, 21 October 2026).
import type { JobView, Notice } from '@crm/data';
import { strings } from './jobs-toast-strings.ts';

const number = new Intl.NumberFormat();

/** How a job ended, in the toast's words: "Done", "Done, 6 refused", "Failed" or "Cancelled". */
export function jobEnding(job: Pick<JobView, 'status' | 'refused'>): string {
  if (job.status === 'failed') return strings.finishedFailed;
  if (job.status === 'cancelled') return strings.finishedCancelled;
  return job.refused > 0 ? strings.finishedRefused(number.format(job.refused)) : strings.finishedDone;
}

/** The toast: its label and how it ended, with View, which opens the Background jobs page. */
export function jobFinishedToast(job: Pick<JobView, 'label' | 'status' | 'refused'>, onView: () => void): Notice {
  return {
    tone: job.status === 'failed' ? 'danger' : 'success',
    message: strings.finished(job.label, jobEnding(job)),
    action: { label: strings.view, onAction: onView },
  };
}

/**
 * A setting saved at once: says what saved ("Invite link saved."), with Undo when `undo` is given, which puts the
 * previous value back. Leave `undo` out when the previous value can't be put back exactly.
 */
export function savedToast(message: string, undo?: { readonly label: string; readonly onUndo: () => void }): Notice {
  return {
    tone: 'success',
    message,
    ...(undo === undefined ? {} : { action: { label: undo.label, onAction: undo.onUndo } }),
  };
}
