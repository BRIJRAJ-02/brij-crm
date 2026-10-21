// Brief
// Purpose: Settings › Account › Security (spec 0033): the devices signed in to this account, and ending them.
// Main task: see each device (browser and system, rough place, last use) and sign one out, or every other one, after a confirm.
// Leaves out: recent activity and alerts (milestone 4), and signing this device out (the account menu does).
import { STEP_UP_MINUTES, type AccountSession, type DataLayer } from '@crm/data';
import { useAccountSecurity, useAccountSessions } from '@crm/data/react';
import { Badge, Button, EmptyState, InfoTip, Modal, RelativeTime, Table, type TableColumn, type Toasts } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { currentFirst, deviceName, devicePlace } from './security-lines.ts';
import { strings } from './security-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';
import { DeleteAccountSection } from './DeleteAccountSection.tsx';
import { useStepUp } from './StepUp.tsx';
import { PasskeysSection } from './PasskeysSection.tsx';
import { TwoFactorSection } from './TwoFactorSection.tsx';

/** How long the confirm takes to leave (`duration-exit` and a frame), before focus is checked again. */
const CONFIRM_EXIT_MS = 200;

const COLUMNS: readonly TableColumn[] = [
  { id: 'device', label: strings.columns.device, isRowHeader: true, isInline: true },
  { id: 'place', label: strings.columns.place },
  { id: 'lastActive', label: strings.columns.lastActive },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

/** The Devices table while it loads: skeleton rows in the loaded table's place. */
export function SecurityLoading() {
  return (
    <Table label={strings.devices} columns={COLUMNS} rows={[]} getRowId={() => ''} renderCell={() => null} isLoading />
  );
}

/** Props for the Security screen. */
export interface SecurityScreenProps {
  readonly data: DataLayer;
  /** The app's toast queue (router context), for how a sign out went. */
  readonly toasts: Toasts;
}

/** Which confirm is showing: one device's sign out, or every other device's. */
type Confirm = { readonly kind: 'one'; readonly session: AccountSession } | { readonly kind: 'others' };

/** Settings › Account › Security: the Devices table, each ending asked first in a danger Modal. */
export function SecurityScreen({ data, toasts }: SecurityScreenProps) {
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

  const signOutOne = async (session: AccountSession) => {
    setIsBusy(true);
    const proven = await stepUp.prove();
    setIsBusy(false);
    if (!proven) return;
    setIsOpen(false);
    focusTitle();
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

  const renderCell = (session: AccountSession, column: string) => {
    if (column === 'device') {
      return (
        <>
          {deviceName(session)}
          {session.current && <Badge text={strings.thisDevice} />}
        </>
      );
    }
    if (column === 'place') return devicePlace(session) ?? strings.unknownPlace;
    if (column === 'lastActive') return session.current ? strings.now : <RelativeTime value={session.lastActiveAt} />;
    if (session.current) return null;
    const place = devicePlace(session);
    return (
      <Button
        variant="danger"
        // Two devices can share a name: the place tells them apart for a screen reader too.
        label={strings.signOutLabel(place === undefined ? deviceName(session) : `${deviceName(session)}, ${place}`)}
        onPress={() => ask({ kind: 'one', session })}
      >
        {strings.signOut}
      </Button>
    );
  };

  let body;
  if (state.status === 'loading') {
    body = <SecurityLoading />;
  } else if (state.status === 'error') {
    body = (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => view.reload()}>
        {state.message}
      </EmptyState>
    );
  } else {
    body = (
      <>
        <Table
          label={strings.devices}
          columns={COLUMNS}
          rows={currentFirst(state.items)}
          getRowId={(session) => session.id}
          renderCell={renderCell}
          emptyState={<EmptyState icon="monitor" title={strings.noDevices} />}
        />
        {state.nextCursor !== undefined && (
          <Button isPending={state.loadingMore} onPress={() => view.loadMore()}>
            {strings.showMore}
          </Button>
        )}
      </>
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
    <SettingsPage
      title={strings.title}
      titleRef={titleRef}
      {...(hasOthers
        ? {
            actions: (
              <>
                <InfoTip label={strings.signOutOthers}>{strings.signOutOthersInfo(STEP_UP_MINUTES)}</InfoTip>
                <Button variant="danger" onPress={() => ask({ kind: 'others' })}>
                  {strings.signOutOthers}
                </Button>
              </>
            ),
          }
        : {})}
    >
      <TwoFactorSection data={data} security={security} toasts={toasts} onFocusLost={focusTitle} />
      <PasskeysSection data={data} security={security} toasts={toasts} onFocusLost={focusTitle} />
      {body}
      <DeleteAccountSection data={data} security={security} />
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
