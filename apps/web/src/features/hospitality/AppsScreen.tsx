// Brief
// Purpose: Settings › Apps (spec 0065, AC-6501 to AC-6506): the business apps every workspace has on, and their switches.
// Main task: an owner or admin opens an app, or turns one off or back on.
// Leaves out: plans and billing (later), and each app's own setup (its page, which starts with the business card).
import type { AppsView, HospitalityApp, HospitalityStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { HOSPITALITY_APPS } from '@crm/data/hospitality';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  Icon,
  Modal,
  Skeleton,
  Switch,
  TileGrid,
  type Toasts,
} from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { businessSettingsHref, servicesSettingsHref } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { strings } from './strings.ts';

/** Props for Settings › Apps. */
export interface AppsScreenProps {
  readonly store: HospitalityStore;
  readonly slug: string;
  readonly toasts: Toasts;
}

/** What the page is asking before a switch goes out. */
type Asking =
  | { readonly kind: 'needs-menu'; readonly app: HospitalityApp }
  | { readonly kind: 'remove'; readonly app: HospitalityApp; readonly withDependents: boolean };

const installed = (view: AppsView, app: HospitalityApp) => view.apps.some((each) => each.app === app && each.installed);

/**
 * The apps still being built: their cards say so and offer no switch, since one turned on would only open an empty
 * page. One already on keeps its switch.
 */
const ON_ITS_WAY: ReadonlySet<HospitalityApp> = new Set(['events']);

/** Where each app's work is. */
const appHref = (slug: string, app: HospitalityApp): string | undefined =>
  ({
    menu: `/w/${slug}/menus`,
    menu_qr: `/w/${slug}/qr`,
    table_seating: `/w/${slug}/reservations`,
    appointments: servicesSettingsHref(slug),
    events: undefined,
  })[app];

/** Settings › Apps: one card per app, with its switch and the way into it, or On its way. */
export function AppsScreen({ store, slug, toasts }: AppsScreenProps) {
  const state = useHospitality(store.apps(slug));
  // What is asked stays set through the Modal's exit, so its title never empties as it closes.
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const [isAsking, setIsAsking] = useState(false);
  const ask = (next: Asking) => {
    setAsking(next);
    setIsAsking(true);
  };
  const [busy, setBusy] = useState<HospitalityApp | undefined>(undefined);
  const view = state.status === 'ready' ? state.value : undefined;

  /** Turned on: Menu QR with Menu off asks to turn both on first. */
  const install = (app: HospitalityApp, withNeeded = false) => {
    if (view === undefined) return;
    if (app === 'menu_qr' && !installed(view, 'menu') && !withNeeded) {
      ask({ kind: 'needs-menu', app });
      return;
    }
    setBusy(app);
    void store.install(slug, app, { withNeeded }).then((refused) => {
      setBusy(undefined);
      toasts.toast(
        refused === undefined
          ? { tone: 'success', message: strings.appInstalled(strings.appNames[app]) }
          : { tone: 'danger', message: refused.message },
      );
    });
  };

  const remove = (app: HospitalityApp, withDependents: boolean) => {
    setIsAsking(false);
    setBusy(app);
    void store.remove(slug, app, withDependents).then((refused) => {
      setBusy(undefined);
      if (refused !== undefined) {
        toasts.toast({ tone: 'danger', message: refused.message });
        return;
      }
      // Every row was kept, so Undo turns it on again as it was (Menu first when Menu QR went with it).
      toasts.toast({
        tone: 'success',
        message: strings.appRemoved(strings.appNames[app]),
        action: {
          label: strings.undo,
          onAction: () => {
            // Menu QR went with Menu: both come back in one write.
            void store
              .install(slug, withDependents ? 'menu_qr' : app, { withNeeded: withDependents })
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
    return (
      <TileGrid>
        {HOSPITALITY_APPS.map((app) => {
          const isOn = view !== undefined && installed(view, app);
          const name = strings.appNames[app];
          const href = appHref(slug, app);
          const status = (): ReactNode => {
            if (view === undefined) return <Skeleton width="short" />;
            if (!isOn && ON_ITS_WAY.has(app)) return <Badge text={strings.appOnItsWay} />;
            if (!view.canManage) return <Badge text={isOn ? strings.appOn : strings.appOff} />;
            return (
              <Switch
                label={name}
                isLabelHidden
                isSelected={isOn}
                // Read only, not disabled, while it saves: the switch keeps focus, also coming back from the Modal.
                isReadOnly={busy === app}
                onChange={(on) => {
                  if (on) install(app);
                  else ask({ kind: 'remove', app, withDependents: app === 'menu' && installed(view, 'menu_qr') });
                }}
              />
            );
          };
          return (
            <Card
              key={app}
              eyebrow={<Icon name={strings.appIcons[app]} tile="blue" />}
              title={name}
              isBusy={view === undefined}
              actions={status()}
              {...(isOn && view.canManage && href !== undefined
                ? {
                    footer: (
                      <ButtonLink href={href} iconRight="arrow-right" label={strings.openApp(name)}>
                        {strings.open}
                      </ButtonLink>
                    ),
                  }
                : {})}
            >
              {/* The app's purpose in the card's body: a card's header keeps no air of its own below it. */}
              {strings.appPurposes[app]}
            </Card>
          );
        })}
      </TileGrid>
    );
  };

  return (
    <SettingsPage
      title={strings.appsTitle}
      {...(view?.hasBusiness === true && view.canManage
        ? {
            actions: (
              <ButtonLink href={businessSettingsHref(slug)} icon="store">
                {strings.businessTitle}
              </ButtonLink>
            ),
          }
        : {})}
    >
      {view !== undefined && !view.canManage && <Callout tone="info">{strings.appsReadOnly}</Callout>}
      {body()}
      <Modal
        isOpen={isAsking && asking?.kind === 'needs-menu'}
        onOpenChange={(open) => {
          if (!open) setIsAsking(false);
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
                setIsAsking(false);
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
        isOpen={isAsking && asking?.kind === 'remove'}
        onOpenChange={(open) => {
          if (!open) setIsAsking(false);
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
              {asking?.kind === 'remove' && asking.withDependents ? strings.removeBoth : strings.turnOff}
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
    </SettingsPage>
  );
}
