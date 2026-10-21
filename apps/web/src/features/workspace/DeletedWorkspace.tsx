// Brief
// Purpose: what an owner sees opening a workspace they deleted, within its 30 days (spec 0031, AC-823).
// Main task: Restore workspace, which brings it back for everyone as it was.
// Leaves out: anything inside the workspace (nobody can open it), and other members (they see not found).
import { isDataError, type DeletedWorkspace } from '@crm/data';
import { Button, Callout, EmptyState, Link, TopBar } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';

/** The day the purge may take it, as people read dates. */
const day = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).format(new Date(iso));

/** The restore page's bar and body, for WorkspacePage. */
export function deletedPage(deleted: DeletedWorkspace, onRestore: () => Promise<void>) {
  return {
    topBar: <TopBar title={strings.deletedTitle(deleted.name)} />,
    body: <RestoreBody deleted={deleted} onRestore={onRestore} />,
  };
}

/** An EmptyState naming the day it goes, with Restore workspace (busy while the server works) and the way home. */
function RestoreBody({
  deleted,
  onRestore,
}: {
  readonly deleted: DeletedWorkspace;
  readonly onRestore: () => Promise<void>;
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
          <Link href="/">{strings.openWorkspace}</Link>
        </>
      }
    >
      {strings.deletedText(day(deleted.purgeAfter))}
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
    </EmptyState>
  );
}
