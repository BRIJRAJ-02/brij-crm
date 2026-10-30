// Brief
// Purpose: what a list's address shows once the list is archived (spec 0048, AC-4831).
// Main task: say "<List> is archived", and let its managers Restore it, which opens it again.
// Leaves out: its entries (they come back with it) and settings (Settings › Lists).
import { isDataError, type DataLayer, type ListView } from '@crm/data';
import { Button, EmptyState, TopBar, type Toasts } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { listHref } from './paths.ts';
import { strings } from './strings.ts';

/** Props for the archived list's page. */
export interface ArchivedListProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly list: ListView;
}

/** "Sales pipeline is archived", with Restore for whoever manages the list. */
export function ArchivedList({ data, toasts, slug, list }: ArchivedListProps) {
  const navigate = useNavigate();
  const [isBusy, setBusy] = useState(false);
  const restore = () => {
    if (isBusy) return;
    setBusy(true);
    data.lists.restore(slug, list.id).then(
      (restored) => {
        setBusy(false);
        toasts.toast({ tone: 'success', message: strings.restoredToast(restored.name) });
        void navigate({ href: listHref(slug, restored) });
      },
      (error: unknown) => {
        setBusy(false);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.restoreFailed });
      },
    );
  };
  return (
    <WorkspacePage
      page={{
        topBar: <TopBar title={list.name} icon={list.icon} hue={list.hue} />,
        body: (
          <EmptyState
            icon="archive"
            title={strings.archivedTitle(list.name)}
            {...(list.canManage
              ? {
                  actions: (
                    <Button icon="archive-restore" isPending={isBusy} onPress={restore}>
                      {strings.restore}
                    </Button>
                  ),
                }
              : {})}
          >
            {strings.archivedText}
          </EmptyState>
        ),
      }}
    />
  );
}
