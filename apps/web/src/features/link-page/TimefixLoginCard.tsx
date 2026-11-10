// Brief
// Purpose: a connected app's person, on their own page inside the app's frame, asks for their own Timefix login (spec
// 0070, AC-7023; owner, 10 Nov 2026), so they can also sign in to Timefix directly. The app keeps managing them.
// Main task: Set up your Timefix login (one email, sent once); with one out, Send again or Cancel invitation.
// Leaves out: anything about the page, roles, and the sign in itself (the emailed link finishes it, signed out).
import { isDataError, type DataLayer, type MyTimefixLogin } from '@crm/data';
import { Button, ButtonGroup, Callout, Card, Modal, sharedStrings } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PageInviteDialog } from './PageInviteDialog.tsx';
import { teamStrings as strings } from './team-strings.ts';

/** Props for the Timefix login card. */
export interface TimefixLoginCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The app the frame sits in, by name, when known. */
  readonly appName: string | undefined;
}

/**
 * A Card under the person's page: what a Timefix login adds, and its one action, read when the page opens. Draws
 * nothing while it reads, for someone who can't set one up, or when the read fails (it is an extra, never in the way).
 */
export function TimefixLoginCard({ data, slug, appName }: TimefixLoginCardProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const [login, setLogin] = useState<MyTimefixLogin | undefined>(undefined);
  const [isAsking, setAsking] = useState(false);
  const [isCancelling, setCancelling] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  useEffect(() => {
    let isCurrent = true;
    data.teamPages.myLogin(slug).then(
      (read) => {
        if (isCurrent) setLogin(read);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug]);

  if (login === undefined || login.memberId === undefined) return null;
  if (!login.canSetUp) {
    return login.hasLogin ? <Card title={strings.ownLoginTitle} description={strings.ownLoginReady} /> : null;
  }
  const memberId = login.memberId;
  const invite = login.invite;
  const cancel = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    data.teamPages.cancelLoginInvite(slug, memberId).then(
      () => {
        setBusy(false);
        setCancelling(false);
        const { invite: _gone, ...rest } = login;
        setLogin(rest);
        toasts.toast({ tone: 'success', message: strings.ownLoginCancelled });
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : sharedStrings.couldntDoThat);
      },
    );
  };
  return (
    <>
      <Card
        title={strings.ownLoginTitle}
        description={
          invite === undefined
            ? strings.ownLoginText(appName)
            : invite.isExpired === true
              ? strings.ownLoginExpired(invite.email)
              : strings.ownLoginInvited(invite.email)
        }
        actions={
          invite === undefined ? (
            <Button variant="secondary" icon="key" onPress={() => setAsking(true)}>
              {strings.ownLoginAction}
            </Button>
          ) : (
            <ButtonGroup label={strings.ownLoginTitle} layout="row">
              <Button icon="send" onPress={() => setAsking(true)}>
                {strings.ownLoginResend}
              </Button>
              {invite.isExpired !== true && (
                <Button
                  variant="ghost"
                  onPress={() => {
                    setFailure(undefined);
                    setCancelling(true);
                  }}
                >
                  {strings.ownLoginCancel}
                </Button>
              )}
            </ButtonGroup>
          )
        }
      />
      {isAsking && (
        <PageInviteDialog
          data={data}
          slug={slug}
          page={{
            memberId,
            name: '',
            ...(login.email === undefined ? {} : { email: login.email }),
            ...(invite === undefined ? {} : { invite }),
          }}
          kind={{ kind: 'own' }}
          onClose={() => setAsking(false)}
          onSent={(sentInvite, sent) => {
            setAsking(false);
            setLogin({ ...login, invite: sentInvite });
            toasts.toast(
              sent
                ? { tone: 'success', message: strings.inviteSent(sentInvite.email) }
                : {
                    tone: 'danger',
                    message: strings.inviteUnsent,
                    action: { label: strings.ownLoginResend, onAction: () => setAsking(true) },
                  },
            );
          }}
        />
      )}
      <Modal
        title={strings.ownLoginCancelTitle}
        variant="confirm"
        tone="danger"
        isOpen={isCancelling}
        isBusy={isBusy}
        onOpenChange={(open) => {
          if (!open && !isBusy) setCancelling(false);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isBusy}>
              {strings.ownLoginKeep}
            </Button>
            <Button variant="danger-solid" isPending={isBusy} onPress={cancel}>
              {strings.ownLoginCancel}
            </Button>
          </>
        }
      >
        {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
        {strings.ownLoginCancelText(invite?.email ?? '')}
      </Modal>
    </>
  );
}
