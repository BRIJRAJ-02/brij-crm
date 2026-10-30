// Brief
// Purpose: what an archived object's address shows (spec 0012, AC-226): that it is archived, inside the frame.
// Main task: owners and admins restore it in place; everyone can go back to the first live object.
// Leaves out: its records (they stay, and show again once it is restored).
import { isDataError, type ObjectSummary } from '@crm/data';
import { Button, EmptyState, Link, sharedStrings, TopBar } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { objectHref, settingsHref } from './objects.ts';
import { strings } from './strings.ts';
import { useCan, WorkspacePage } from './WorkspacePage.tsx';

/** Props for an archived object's page. */
export interface ArchivedObjectScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** Where "Back to" goes: the first live object by the workspace's order, if any. */
  readonly firstLive: ObjectSummary | undefined;
}

/** "<Plural> is archived", with Restore for owners and admins and the way back for everyone. */
export function ArchivedObjectScreen({ slug, object, firstLive }: ArchivedObjectScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canManage = useCan('schema.manage');
  const [isRestoring, setRestoring] = useState(false);
  const restore = () => {
    if (isRestoring) return;
    setRestoring(true);
    // Server confirmed: once it lands the data layer reloads the pages, and this address shows the table again.
    data.objects.restore(slug, object.id).then(
      () => {
        setRestoring(false);
        toasts.toast({ tone: 'success', message: strings.objectRestored(object.pluralName) });
        // The address stays the same, so no route change moves focus: the table's title takes it.
        focusTitle();
      },
      (error: unknown) => {
        setRestoring(false);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : sharedStrings.couldntDoThat });
      },
    );
  };
  const back =
    firstLive === undefined ? (
      <Link href={settingsHref(slug)}>{strings.openSettings}</Link>
    ) : (
      <Link href={objectHref(slug, firstLive)}>{strings.backTo(firstLive.pluralName)}</Link>
    );
  return (
    <WorkspacePage
      page={{
        topBar: <TopBar title={object.pluralName} icon={object.icon} hue={object.hue} />,
        body: (
          <EmptyState
            icon="archive"
            title={strings.objectArchived(object.pluralName)}
            actions={
              <>
                {canManage && (
                  <Button variant="primary" icon="archive-restore" isPending={isRestoring} onPress={restore}>
                    {isRestoring ? strings.restoring : strings.restore}
                  </Button>
                )}
                {back}
              </>
            }
          >
            {canManage ? undefined : strings.objectArchivedMemberText}
          </EmptyState>
        ),
      }}
    />
  );
}
