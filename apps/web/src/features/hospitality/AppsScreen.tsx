// Brief
// Purpose: Settings › Apps (spec 0065, AC-6501 to AC-6506): the apps a workspace can switch on, Hospitality first.
// Main task: an owner or admin installs an app in one press (the business card the first time), or removes one.
// Leaves out: plans and billing (later), each app's own setup (its page), and anything without early access.
import type { AppsView, FirstBusiness, HospitalityApp, HospitalityStore, WorkspaceSettings } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { HOSPITALITY_APPS } from '@crm/data/hospitality';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  Icon,
  Modal,
  sharedStrings,
  Skeleton,
  TileGrid,
  type Toasts,
} from '@crm/ui';
import { useState } from 'react';
import { businessSettingsHref } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { BusinessCardDialog } from './BusinessCardDialog.tsx';
import { strings } from './strings.ts';

/** Props for Settings › Apps. */
export interface AppsScreenProps {
  readonly store: HospitalityStore;
  readonly slug: string;
  /** The workspace's settings, for the business card's first values. */
  readonly workspace: WorkspaceSettings | undefined;
  readonly toasts: Toasts;
}

/** What the page is asking before an install or a remove goes out. */
type Asking =
  | { readonly kind: 'needs-menu'; readonly app: HospitalityApp }
  | { readonly kind: 'card'; readonly app: HospitalityApp; readonly withNeeded: boolean }
  | { readonly kind: 'remove'; readonly app: HospitalityApp; readonly withDependents: boolean };

const installed = (view: AppsView, app: HospitalityApp) => view.apps.some((each) => each.app === app && each.installed);

/** Settings › Apps: one card per app, Install or Installed with Remove. */
export function AppsScreen({ store, slug, workspace, toasts }: AppsScreenProps) {
  const state = useHospitality(store.apps(slug));
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const [busy, setBusy] = useState<HospitalityApp | undefined>(undefined);
  const view = state.status === 'ready' ? state.value : undefined;

  const send = (app: HospitalityApp, withNeeded: boolean, business?: FirstBusiness) => {
    setBusy(app);
    return store.install(slug, app, { withNeeded, ...(business === undefined ? {} : { business }) }).then((refused) => {
      setBusy(undefined);
      if (refused !== undefined) throw refused;
      toasts.toast({ tone: 'success', message: strings.appInstalled(strings.appNames[app]) });
    });
  };

  /** Install pressed: ask for Menu first, then the card, then send. */
  const install = (app: HospitalityApp, withNeeded = false) => {
    if (view === undefined) return;
    if (app === 'menu_qr' && !installed(view, 'menu') && !withNeeded) {
      setAsking({ kind: 'needs-menu', app });
      return;
    }
    if (!view.hasBusiness) {
      setAsking({ kind: 'card', app, withNeeded });
      return;
    }
    void send(app, withNeeded).catch((error: unknown) => {
      toasts.toast({ tone: 'danger', message: error instanceof Error ? error.message : sharedStrings.couldntDoThat });
    });
  };

  const remove = (app: HospitalityApp, withDependents: boolean) => {
    setAsking(undefined);
    setBusy(app);
    void store.remove(slug, app, withDependents).then((refused) => {
      setBusy(undefined);
      if (refused !== undefined) {
        toasts.toast({ tone: 'danger', message: refused.message });
        return;
      }
      // Every row was kept, so Undo installs it again as it was (Menu first when Menu QR went with it).
      toasts.toast({
        tone: 'success',
        message: strings.appRemoved(strings.appNames[app]),
        action: {
          label: strings.undo,
          onAction: () => {
            void store
              .install(slug, app)
              .then(() => (withDependents ? store.install(slug, 'menu_qr') : undefined))
              .then((refused2) => {
                if (refused2 !== undefined) toasts.toast({ tone: 'danger', message: refused2.message });
              });
          },
        },
      });
    });
  };

  const body = () => {
    if (state.status === 'error') {
      return (
        <EmptyState
          title={strings.failed}
          icon="blocks"
          actions={<Button onPress={() => store.apps(slug).retry()}>{strings.retry}</Button>}
        />
      );
    }
    if (view !== undefined && !view.available) {
      return (
        <EmptyState title={strings.noApps} icon="blocks">
          {strings.noAppsText}
        </EmptyState>
      );
    }
    return (
      <TileGrid>
        {HOSPITALITY_APPS.map((app) => {
          const isOn = view !== undefined && installed(view, app);
          return (
            <Card
              key={app}
              eyebrow={<Icon name={strings.appIcons[app]} tile="blue" />}
              title={strings.appNames[app]}
              description={strings.appPurposes[app]}
              isBusy={view === undefined}
              footer={
                view === undefined ? (
                  <Skeleton width="short" />
                ) : isOn ? (
                  view.canManage && (
                    <Button
                      variant="ghost"
                      isPending={busy === app}
                      label={strings.removeNamed(strings.appNames[app])}
                      onPress={() =>
                        setAsking({
                          kind: 'remove',
                          app,
                          withDependents: app === 'menu' && installed(view, 'menu_qr'),
                        })
                      }
                    >
                      {strings.remove}
                    </Button>
                  )
                ) : (
                  view.canManage && (
                    <Button
                      variant="primary"
                      icon="plus"
                      isPending={busy === app}
                      label={strings.installNamed(strings.appNames[app])}
                      onPress={() => install(app)}
                    >
                      {busy === app ? strings.installing : strings.install}
                    </Button>
                  )
                )
              }
            />
          );
        })}
      </TileGrid>
    );
  };

  return (
    <SettingsPage
      title={strings.appsTitle}
      {...(view?.hasBusiness === true
        ? {
            actions: (
              <ButtonLink href={businessSettingsHref(slug)} icon="store">
                {strings.businessTitle}
              </ButtonLink>
            ),
          }
        : {})}
    >
      {view !== undefined && view.available && !view.canManage && <Callout>{strings.appsReadOnly}</Callout>}
      {body()}
      <Modal
        isOpen={asking?.kind === 'needs-menu'}
        onOpenChange={(open) => {
          if (!open) setAsking(undefined);
        }}
        title={strings.needsMenuTitle}
        variant="confirm"
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="primary"
              onPress={() => {
                const app = asking?.app ?? 'menu_qr';
                setAsking(undefined);
                install(app, true);
              }}
            >
              {strings.installBoth}
            </Button>
          </>
        }
      >
        {strings.needsMenuText}
      </Modal>
      <Modal
        isOpen={asking?.kind === 'remove'}
        onOpenChange={(open) => {
          if (!open) setAsking(undefined);
        }}
        title={strings.removeTitle(asking === undefined ? '' : strings.appNames[asking.app])}
        variant="confirm"
        tone="danger"
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                if (asking?.kind === 'remove') remove(asking.app, asking.withDependents);
              }}
            >
              {asking?.kind === 'remove' && asking.withDependents ? strings.removeBoth : strings.remove}
            </Button>
          </>
        }
      >
        {asking?.kind === 'remove'
          ? asking.withDependents
            ? `${strings.removeText[asking.app]} ${strings.removeBothText}`
            : strings.removeText[asking.app]
          : null}
      </Modal>
      <BusinessCardDialog
        isOpen={asking?.kind === 'card'}
        onOpenChange={(open) => {
          if (!open) setAsking(undefined);
        }}
        workspace={workspace}
        firstKind={asking?.kind === 'card' && asking.app === 'appointments' ? 'salon' : 'restaurant'}
        onInstall={(business) =>
          asking?.kind === 'card' ? send(asking.app, asking.withNeeded, business) : Promise.resolve()
        }
      />
    </SettingsPage>
  );
}
