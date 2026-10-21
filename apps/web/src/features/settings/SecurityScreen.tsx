// Brief
// Purpose: Settings › Account › Security (spec 0033): the browsers signed in to this account, and ending them.
// Main task: see each device (browser and system, rough place, last use) and sign one out, or every other one, after a confirm.
// Leaves out: two factor and passkeys (milestones 2 and 3), recent activity and alerts (milestone 4), signing this device out (the account menu does).
import { STEP_UP_MINUTES, type AccountSession, type DataLayer, type SignOutOthersResult } from '@crm/data';
import { useAccountSessions } from '@crm/data/react';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  InfoTip,
  Modal,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type Toasts,
} from '@crm/ui';
import { useState } from 'react';
import { deviceDetail, deviceName } from './security-lines.ts';
import { strings } from './security-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** The Devices card while it loads: its header, and a busy row where each device will list. */
export function SecurityLoading() {
  return (
    <SettingsSection title={strings.devices}>
      <Card isBusy>
        <Skeleton width="long" />
        <Skeleton width="medium" />
      </Card>
    </SettingsSection>
  );
}

/** Props for the Security screen. */
export interface SecurityScreenProps {
  readonly data: DataLayer;
  /** The app's toast queue (router context), for how a sign out of every other device went. */
  readonly toasts: Toasts;
}

/** Which confirm is open: one device's sign out, or every other device's. */
type Confirm = { readonly kind: 'one'; readonly session: AccountSession } | { readonly kind: 'others' };

/** Settings › Account › Security: the Devices list, each ending asked first in a danger Modal. */
export function SecurityScreen({ data, toasts }: SecurityScreenProps) {
  const view = data.account.sessions();
  const state = useAccountSessions(view);
  const [confirm, setConfirm] = useState<Confirm | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<SignOutOthersResult | undefined>(undefined);

  const close = () => {
    setConfirm(undefined);
    setRefusal(undefined);
  };

  const signOutOne = (session: AccountSession) => {
    // Gone from the list at once; a refusal puts it back with a toast from the data layer.
    close();
    void data.account.signOut(session.id);
  };

  const signOutOthers = async () => {
    setIsBusy(true);
    const answer = await data.account.signOutOthers();
    setIsBusy(false);
    if (answer.ok) {
      close();
      toasts.toast({ tone: 'success', message: strings.signedOutOthers(answer.count) });
    } else if (answer.code === 'STEP_UP_REQUIRED') {
      // Said inside the confirm, where the person is looking; the toast was the layer's to skip.
      setRefusal(answer);
    } else {
      close();
    }
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
    const others = state.items.filter((each) => !each.current);
    body = (
      <SettingsSection
        title={strings.devices}
        description={<InfoTip label={strings.devices}>{strings.devicesInfo}</InfoTip>}
      >
        <Card
          footer={
            others.length > 0 || state.nextCursor !== undefined ? (
              <>
                {state.nextCursor !== undefined && (
                  <Button isPending={state.loadingMore} onPress={() => view.loadMore()}>
                    {strings.showMore}
                  </Button>
                )}
                <Button variant="danger" onPress={() => setConfirm({ kind: 'others' })}>
                  {strings.signOutOthers}
                </Button>
              </>
            ) : undefined
          }
        >
          {state.items.map((session) => (
            <SettingsRow key={session.id} title={deviceName(session)} description={deviceDetail(session)}>
              {session.current ? (
                <Badge text={strings.thisDevice} />
              ) : (
                <Button
                  variant="danger"
                  label={strings.signOutLabel(deviceName(session))}
                  onPress={() => setConfirm({ kind: 'one', session })}
                >
                  {strings.signOut}
                </Button>
              )}
            </SettingsRow>
          ))}
        </Card>
      </SettingsSection>
    );
  }

  const one = confirm?.kind === 'one' ? confirm.session : undefined;
  return (
    <SettingsPage title={strings.title} isLoading={state.status === 'loading'}>
      {body}
      <Modal
        title={one === undefined ? strings.signOutOthersTitle : strings.signOutTitle(deviceName(one))}
        tone="danger"
        isOpen={confirm !== undefined}
        isBusy={isBusy}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isBusy) close();
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC" isDisabled={isBusy}>
              {strings.cancel}
            </Button>
            {refusal === undefined && (
              <Button
                variant="danger-solid"
                isPending={isBusy}
                onPress={() => {
                  if (one === undefined) void signOutOthers();
                  else signOutOne(one);
                }}
              >
                {isBusy ? strings.signingOut : one === undefined ? strings.signOutOthers : strings.signOut}
              </Button>
            )}
          </>
        }
      >
        {refusal === undefined ? (
          one === undefined ? (
            strings.signOutOthersText
          ) : (
            strings.signOutText
          )
        ) : (
          <Callout tone="warning" title={strings.stepUpTitle} isAnnounced>
            {strings.stepUpText(STEP_UP_MINUTES)}
          </Callout>
        )}
      </Modal>
    </SettingsPage>
  );
}
