// Brief
// Purpose: what the first publish ends on (spec 0058, AC-6, AC-21; T44): the form is live, here is its link. The
// publish itself is one click with nothing asked first (the owner, 5 November 2026, after Tally): the name it has, a
// link made from it, and answers matched to fields automatically; all of it changes later in Settings.
// Main task: copy the link (the dialog's one primary), or pass it on from the share row.
// Leaves out: the embed code (one quiet row to the Share tab, where it is set up with a preview), the name and
// where answers go (Settings), and later publishes (a toast is enough).
import type { FormView } from '@crm/data';
import { Button, Link, Modal } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { formHref } from './paths.ts';
import { ShareBlock } from './ShareBlock.tsx';
import { strings } from './strings.ts';

/** Props for the Ready dialog. */
export interface ReadyDialogProps {
  /** The workspace the form is in, for the Share tab's address. */
  readonly slug: string;
  /** The form just put live; undefined while the dialog is closed. */
  readonly form: FormView | undefined;
  readonly onClose: () => void;
}

/** "<Form> is live": the link as a pill with Copy, the share row, a quiet way to the embeds, and Done. */
export function ReadyDialog({ slug, form, onClose }: ReadyDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  // The last form stays while the Modal plays its exit.
  const [last, setLast] = useState(form);
  if (form !== undefined && form !== last) setLast(form);
  const live = form ?? last;
  if (live === undefined) return null;
  return (
    <Modal
      // One line says it all (T44): the form's name, live. Said as the dialog's name, so the success is heard too.
      title={strings.liveTitleOf(live.name)}
      variant="form"
      isOpen={form !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        // Copy link is the dialog's one primary; Done only closes it. Focus starts on Done, so Enter and Esc both
        // close the dialog and the dialog is said with its name.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        <Button key="done" slot="close" autoFocus>
          {strings.done}
        </Button>
      }
    >
      <ShareBlock name={live.name} link={data.forms.hostedUrl(live.publicKey)}>
        <Link href={formHref(slug, live.id, 'share')} onPress={onClose}>
          {strings.putOnSite}
        </Link>
      </ShareBlock>
    </Modal>
  );
}
