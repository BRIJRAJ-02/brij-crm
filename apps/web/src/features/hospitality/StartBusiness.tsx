// Brief
// Purpose: the first screen of every business page before the business exists (spec 0065): every workspace has the
// apps on, so this is what someone who has never heard of them meets.
// Main task: fill in the short business card, which makes the business and its first place, and carry on.
// Leaves out: anything public. The card publishes nothing, and no guest page exists until someone publishes one.
import type { BusinessKind, HospitalityApp, HospitalityStore, WorkspaceSettings } from '@crm/data';
import { Button, EmptyState, type IconName } from '@crm/ui';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { BusinessCardDialog } from './BusinessCardDialog.tsx';
import { strings } from './strings.ts';

/** Props for the first screen. */
export interface StartBusinessProps {
  readonly slug: string;
  /** The app whose page this is; the card sets up what all the apps share. */
  readonly app: HospitalityApp;
  readonly icon: IconName;
  readonly title: string;
  /** What this page does, and why the business comes first. */
  readonly text: string;
  /** The business exists now: the page reads its copy again. */
  readonly onDone: () => void;
}

/** The kind the card starts on: a salon for Appointments, a restaurant for the food apps. */
const firstKind = (app: HospitalityApp): BusinessKind => (app === 'appointments' ? 'salon' : 'restaurant');

/** What the page shows with no business yet: one line, and Set up your business for those who may. */
export function StartBusiness({ slug, app, icon, title, text, onDone }: StartBusinessProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const router = useRouter();
  const canStart = useCan('workspace.manage');
  const [isOpening, setOpening] = useState(false);
  const [card, setCard] = useState<
    { readonly store: HospitalityStore; readonly workspace: WorkspaceSettings | undefined } | undefined
  >(undefined);

  const open = () => {
    setOpening(true);
    void Promise.all([data.hospitality.load(), data.workspace.get(slug).catch(() => undefined)]).then(
      ([store, workspace]) => {
        setOpening(false);
        setCard({ store, workspace });
      },
      () => {
        setOpening(false);
        toasts.toast({ tone: 'danger', message: strings.failed });
      },
    );
  };

  return (
    <>
      <EmptyState
        layout="block"
        icon={icon}
        title={title}
        {...(canStart
          ? {
              actions: (
                <Button variant="primary" icon="store" isPending={isOpening} onPress={open}>
                  {strings.setUp}
                </Button>
              ),
            }
          : {})}
      >
        {canStart ? text : strings.setUpAsk}
      </EmptyState>
      <BusinessCardDialog
        isOpen={card !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setCard(undefined);
        }}
        workspace={card?.workspace}
        firstKind={firstKind(app)}
        onInstall={async (business) => {
          const refused = await card?.store.install(slug, app, { business });
          if (refused !== undefined) throw refused;
          toasts.toast({ tone: 'success', message: strings.setUpDone });
          onDone();
          void router.invalidate();
        }}
      />
    </>
  );
}
