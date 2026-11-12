// Brief
// Purpose: what the first publish ends on (spec 0058, AC-6, AC-21; T44): the form is live, here is its link. The
// publish itself is one click with nothing asked first (the owner, 5 November 2026, after Tally): the name it has, a
// link made from it, and answers matched to fields automatically; all of it changes later in Settings.
// Main task: copy the link (the sheet's one primary), or pass it on from the row of equal buttons.
// Leaves out: the embed code (one row to the Share tab, where it is set up with a preview), changing the name and
// where answers go (Settings; the footer says where they go, with Change), and later publishes (a toast is enough).
// Drawn by the library's ShareSheet, the one share dialog (spec 0074, AC-7401).
import type { FormView } from '@crm/data';
import { Link, ShareSheet } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { formHref } from './paths.ts';
import { strings } from './strings.ts';

/** Props for the Ready dialog. */
export interface ReadyDialogProps {
  /** The workspace the form is in, for the Share tab's address. */
  readonly slug: string;
  /** The form just put live; undefined while the dialog is closed. */
  readonly form: FormView | undefined;
  readonly onClose: () => void;
  /** What the first publish set up in the CRM: where answers go, and the fields it made for them. */
  readonly filing?: LiveFiling;
}

/** Where a first publish files answers (the object's name) and the fields it made for them, by name. */
export interface LiveFiling {
  readonly objectName: string;
  readonly made: readonly string[];
}

/** "<Form> is live": the QR code, the link with Copy link, the share row, a row to the embeds, and Done. */
export function ReadyDialog({ slug, form, onClose, filing }: ReadyDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  // The last form stays while the sheet plays its exit.
  const [last, setLast] = useState(form);
  if (form !== undefined && form !== last) setLast(form);
  const live = form ?? last;
  if (live === undefined) return null;
  return (
    <ShareSheet
      // One line says it all (T44): the form's name, live. Said as the dialog's name, so the success is heard too.
      title={strings.liveTitleOf(live.name)}
      isOpen={form !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      url={data.forms.hostedUrl(live.publicKey)}
      name={live.name}
      embedHref={formHref(slug, live.id, 'share')}
      // What the publish set up, said once as the footer's quiet line with the way to change it, on one line:
      // "Answers go to People · Change" (the owner, 5 November 2026: the Callout wrapped Change onto its own line).
      {...(filing === undefined || filing.objectName === ''
        ? {}
        : {
            footer: (
              <>
                {strings.liveFiling(filing.objectName, filing.made)}
                {' · '}
                <Link href={formHref(slug, live.id, 'settings')} onPress={onClose}>
                  {strings.changeFiling}
                </Link>
              </>
            ),
          })}
    />
  );
}
