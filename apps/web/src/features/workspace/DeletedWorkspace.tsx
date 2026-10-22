// Brief
// Purpose: what an owner sees opening a workspace they deleted, within its 30 days (spec 0031, AC-823).
// Main task: Restore workspace, which brings it back for everyone as it was.
// Leaves out: anything inside the workspace (nobody can open it), and other members (they see not found).
// When it was the person's last workspace, Settings can't open anywhere, so the page also offers a new workspace and
// Delete your account (the account's confirm sent them here: delete the workspace first).
import { isDataError, type DataLayer, type DeletedWorkspace } from '@crm/data';
import { Button, Callout, EmptyState, Link, TopBar } from '@crm/ui';
import { useState } from 'react';
import { DeleteAccountAction } from '../settings/DeleteAccountSection.tsx';
import { strings } from './strings.ts';

/** The day the purge may take it, as people read dates. */
const day = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).format(new Date(iso));

/** The restore page's bar and body, for WorkspacePage. */
export function deletedPage(
  deleted: DeletedWorkspace,
  onRestore: () => Promise<void>,
  person: { readonly data: DataLayer; readonly hasOther: boolean },
) {
  return {
    topBar: <TopBar title={deleted.name} />,
    body: <RestoreBody deleted={deleted} onRestore={onRestore} person={person} />,
  };
}

/**
 * An EmptyState naming the day it goes, with Restore workspace (busy while the server works) and the way home; when
 * the person has no other workspace, that way starts a new one, and Delete your account follows.
 */
function RestoreBody({
  deleted,
  onRestore,
  person,
}: {
  readonly deleted: DeletedWorkspace;
  readonly onRestore: () => Promise<void>;
  readonly person: { readonly data: DataLayer; readonly hasOther: boolean };
}) {
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const restore = () => {
    setBusy(true);
    setFailure(undefined);
    onRestore().catch((error: unknown) => {
      setBusy(false);
      setFailure(isDataError(error) ? error.message : strings.restoreFailed);
    });
  };
  return (
    <EmptyState
      icon="trash"
      title={strings.deletedTitle(deleted.name)}
      actions={
        <>
          <Button variant="primary" isPending={isBusy} onPress={restore}>
            {strings.restoreWorkspace}
          </Button>
          <Link href="/">{person.hasOther ? strings.backToWorkspaces : strings.startWorkspace}</Link>
          {!person.hasOther && <DeleteAccountAction data={person.data} />}
        </>
      }
    >
      {strings.deletedText(day(deleted.purgeAfter))}
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
    </EmptyState>
  );
}
