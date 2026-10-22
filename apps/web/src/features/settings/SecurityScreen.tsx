// Brief
// Purpose: Settings › Account › Sign in and devices (spec 0033): how this account signs in, the devices signed in to it, and what happened lately.
// Main task: see each device (browser and system, rough place, last use) and sign one out, or every other one, after a confirm.
// Leaves out: signing this device out (the account menu does).
import { type AccountSession, type ActivityPage, type DataLayer } from '@crm/data';
import { useAccountSecurity, useAccountSessions } from '@crm/data/react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Modal,
  RelativeTime,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type Toasts,
} from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { currentFirst, deviceIcon, deviceName, devicePlace } from './security-lines.ts';
import { strings } from './security-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';
import { useStepUp } from './StepUp.tsx';
import { RecentActivitySection } from './RecentActivitySection.tsx';
import { TwoFactorSection } from './TwoFactorSection.tsx';

/** How long the confirm takes to leave (`duration-exit` and a frame), before focus is checked again. */
const CONFIRM_EXIT_MS = 200;

/** A busy Card of rows: one section's content while its read is out. */
function BusyRows({
  rows,
  hasControl = true,
  hasLeading = false,
}: {
  readonly rows: number;
  readonly hasControl?: boolean;
  /** A device row's icon place, so the text doesn't move right as the list arrives. */
  readonly hasLeading?: boolean;
}) {
  return (
    <Card isBusy>
      {Array.from({ length: rows }, (_, index) => (
        <SettingsRow
          key={index}
          title=""
          description={<Skeleton width="medium" />}
          {...(hasLeading ? { leading: <Skeleton shape="tile" />, leadingAlign: 'center' as const } : {})}
        >
          {hasControl && <Skeleton width="short" />}
        </SettingsRow>
      ))}
    </Card>
  );
}

/**
 * The page while it loads: every section in its place (two factor,
 * devices, recent activity), each a busy card, so nothing moves as it arrives.
 */
export function SecurityLoading() {
  return (
    <>
      <SettingsSection title={strings.twoFactor.section} description={strings.twoFactor.description}>
        <BusyRows rows={1} />
      </SettingsSection>
      <DevicesLoading />
      <SettingsSection title={strings.activity.section} description={strings.activity.description}>
        {/* Activity rows have no control, as its own loading rows don't. */}
        <BusyRows rows={3} hasControl={false} />
      </SettingsSection>
    </>
  );
}

/** The devices section while its list loads. */
function DevicesLoading() {
  return (
    <SettingsSection title={strings.devices} description={strings.devicesDescription}>
      <BusyRows rows={3} hasLeading />
    </SettingsSection>
  );
}

/** A device's line under its name: where, when the edge knew it, then when it was last used. */
function DeviceLine({ session }: { readonly session: AccountSession }) {
  const place = devicePlace(session);
  return (
    <>
      {place === undefined ? '' : `${place} · `}
      {session.current ? (
        strings.activeNow
      ) : (
        <>
          {strings.active} <RelativeTime value={session.lastActiveAt} />
        </>
      )}
    </>
  );
}

/** Props for the Security screen. */
export interface SecurityScreenProps {
  readonly data: DataLayer;
  /** The app's toast queue (router context), for how a sign out went. */
  readonly toasts: Toasts;
  /** Recent activity's first page as the route's loader started it: undefined once read when that read failed. */
  readonly activity?: Promise<ActivityPage | undefined>;
  /** Reads Recent activity again after a failure. */
  readonly onActivityRetry?: () => void;
}

/** Which confirm is showing: one device's sign out, or every other device's. */
type Confirm = { readonly kind: 'one'; readonly session: AccountSession } | { readonly kind: 'others' };

/** Settings › Account › Sign in and devices: each section a Card of rows, each ending asked first in a danger Modal. */
export function SecurityScreen({ data, toasts, activity, onActivityRetry = () => undefined }: SecurityScreenProps) {
  const view = data.account.sessions();
  const state = useAccountSessions(view);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // The confirm's content stays as it was while it fades out; `isOpen` alone opens and closes it.
  const [confirm, setConfirm] = useState<Confirm>({ kind: 'others' });
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  // Signing a device out needs a recent check (AC-896): asked inline in the confirm when this session isn't fresh.
  const security = useAccountSecurity(data.account.security());
  // A complete code in the confirm runs it, as its button would.
  const commit = useRef<() => void>(() => undefined);
  const stepUp = useStepUp(data, security, { onComplete: () => commit.current() });

  const ask = (next: Confirm) => {
    setConfirm(next);
    stepUp.reset();
    setIsOpen(true);
  };

  /** The confirm's trigger may have gone with the change: the page's title takes focus rather than the document. */
  const focusTitle = () => {
    requestAnimationFrame(() => titleRef.current?.focus());
    setTimeout(() => {
      if (document.activeElement === document.body) titleRef.current?.focus();
    }, CONFIRM_EXIT_MS);
  };

  /**
   * After one device's sign out: Sign out of all other devices, beside the rows, while it is still there, so the
   * next sign out is a Tab away; the page's title once it went too.
   */
  const othersRef = useRef<HTMLButtonElement>(null);
  const focusDevices = () => {
    const target = () => (othersRef.current?.isConnected === true ? othersRef.current : titleRef.current);
    requestAnimationFrame(() => target()?.focus());
    setTimeout(() => {
      if (document.activeElement === document.body) target()?.focus();
    }, CONFIRM_EXIT_MS);
  };

  const signOutOne = async (session: AccountSession) => {
    setIsBusy(true);
    const proven = await stepUp.prove();
    setIsBusy(false);
    if (!proven) return;
    setIsOpen(false);
    focusDevices();
    // Gone from the table at once; a refusal puts it back with a toast from the data layer.
    void data.account.signOut(session.id).then((landed) => {
      if (landed) toasts.toast({ tone: 'success', message: strings.signedOut(deviceName(session)) });
    });
  };

  const signOutOthers = async () => {
    setIsBusy(true);
    if (!(await stepUp.prove())) {
      setIsBusy(false);
      return;
    }
    const answer = await data.account.signOutOthers();
    setIsBusy(false);
    if (answer.ok) {
      setIsOpen(false);
      focusTitle();
      toasts.toast({ tone: 'success', message: strings.signedOutOthers(answer.count) });
    } else if (answer.code === 'STEP_UP_REQUIRED') {
      // The check ran out meanwhile: read the state again, so the confirm asks for it inline.
      void data.account.security().reload();
    } else {
      setIsOpen(false);
    }
  };

  const hasOthers =
    state.status === 'ready' && (state.items.some((each) => !each.current) || state.nextCursor !== undefined);

  // One row per device, as GitHub's sessions list them: its kind's icon, its name, where and when, and Sign out.
  const deviceRow = (session: AccountSession) => {
    const place = devicePlace(session);
    return (
      <SettingsRow
        key={session.id}
        leading={<Icon name={deviceIcon(session)} tone="muted" />}
        leadingAlign="center"
        title={deviceName(session)}
        {...(session.current ? { meta: <Badge text={strings.thisDevice} isWhole /> } : {})}
        description={<DeviceLine session={session} />}
      >
        {!session.current && (
          <Button
            // Quiet in every row: the danger confirm carries the weight, so the list isn't a column of red buttons.
            variant="secondary"
            // Two devices can share a name: the place tells them apart for a screen reader too.
            label={strings.signOutLabel(place === undefined ? deviceName(session) : `${deviceName(session)}, ${place}`)}
            onPress={() => ask({ kind: 'one', session })}
          >
            {strings.signOut}
          </Button>
        )}
      </SettingsRow>
    );
  };

  let body;
  if (state.status === 'loading') {
    body = <DevicesLoading />;
  } else if (state.status === 'error') {
    // The section keeps its heading when the list fails, so the page holds its shape in every state.
    body = (
      <SettingsSection title={strings.devices} description={strings.devicesDescription}>
        <EmptyState tone="error" title={strings.failedTitle} onRetry={() => view.reload()}>
          {state.message}
        </EmptyState>
      </SettingsSection>
    );
  } else {
    body = (
      <SettingsSection
        title={strings.devices}
        description={strings.devicesDescription}
        // The one action over the whole list sits at its heading, beside the rows it ends.
        {...(hasOthers
          ? {
              actions: (
                <>
                  <Button ref={othersRef} variant="danger" onPress={() => ask({ kind: 'others' })}>
                    {strings.signOutOthers}
                  </Button>
                </>
              ),
            }
          : {})}
      >
        <Card>
          {state.items.length === 0 ? (
            <EmptyState layout="row" icon="monitor" title={strings.noDevices} />
          ) : (
            currentFirst(state.items).map(deviceRow)
          )}
        </Card>
        {state.nextCursor !== undefined && (
          <Button isPending={state.loadingMore} onPress={() => view.loadMore()}>
            {strings.showMore}
          </Button>
        )}
      </SettingsSection>
    );
  }

  const one = confirm.kind === 'one' ? confirm.session : undefined;
  // A complete code in the confirm, or its button, runs the sign out the confirm asks about.
  useEffect(() => {
    commit.current = () => {
      if (isBusy) return;
      if (one === undefined) void signOutOthers();
      else void signOutOne(one);
    };
  });
  const onePlace = one === undefined ? undefined : devicePlace(one);
  return (
    <SettingsPage title={strings.title} titleRef={titleRef}>
      <TwoFactorSection data={data} security={security} toasts={toasts} onFocusLost={focusTitle} />
      {body}
      {activity !== undefined && <RecentActivitySection data={data} first={activity} onRetry={onActivityRetry} />}
      <Modal
        title={one === undefined ? strings.signOutOthersTitle : strings.signOutTitle(deviceName(one))}
        tone="danger"
        isOpen={isOpen}
        isBusy={isBusy}
        onOpenChange={(open) => {
          if (!open && !isBusy) setIsOpen(false);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC" isDisabled={isBusy}>
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isBusy} onPress={() => commit.current()}>
              {isBusy ? strings.signingOut : one === undefined ? strings.signOutOthers : strings.signOut}
            </Button>
          </>
        }
      >
        {one === undefined ? strings.signOutOthersText : strings.signOutText(onePlace)}
        {stepUp.fields}
      </Modal>
    </SettingsPage>
  );
}
