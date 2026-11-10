// Brief
// Purpose: a connected app's person, on their own page inside the app's frame, asks for their own Timefix login (spec
// 0070, AC-7023; owner, 10 Nov 2026), so they can also sign in to Timefix directly. The app keeps managing them.
// Main task: Set up your Timefix login (one email, sent once); with one out, Resend invitation or Revoke invitation.
// Leaves out: anything about the page, roles, the sign in itself (the emailed link finishes it, signed out), and any
// card once they have a login (nothing left to do here).
import { type DataLayer, type MyTimefixLogin } from '@crm/data';
import { Button, ButtonGroup, Card } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CancelPageInvite, PageInviteDialog, type CancelledInvite } from './PageInviteDialog.tsx';
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
 * nothing while it reads, when the read fails (it is an extra, never in the way), or for someone who can't set one up
 * (anyone with a login already). With an invitation out, its two actions sit in the footer, which wraps on a phone.
 */
export function TimefixLoginCard({ data, slug, appName }: TimefixLoginCardProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const [login, setLogin] = useState<MyTimefixLogin | undefined>(undefined);
  const [isAsking, setAsking] = useState(false);
  const [revoking, setRevoking] = useState<CancelledInvite | undefined>(undefined);
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

  if (login?.memberId === undefined || !login.canSetUp) return null;
  const memberId = login.memberId;
  const invite = login.invite;
  // Who the dialogs are about: the caller, with the address the app gave and their open invitation.
  const self: CancelledInvite & { readonly email?: string } = {
    memberId,
    name: '',
    ...(login.email === undefined ? {} : { email: login.email }),
    ...(invite === undefined ? {} : { invite }),
  };
  return (
    <>
      {invite === undefined ? (
        <Card
          title={strings.ownLoginTitle}
          description={strings.ownLoginText(appName)}
          actions={
            <Button variant="secondary" icon="key" onPress={() => setAsking(true)}>
              {strings.ownLoginAction}
            </Button>
          }
        />
      ) : (
        <Card
          title={strings.ownLoginTitle}
          description={
            invite.isExpired === true ? strings.ownLoginExpired(invite.email) : strings.ownLoginInvited(invite.email)
          }
          footer={
            <ButtonGroup label={strings.ownLoginTitle} layout="row">
              <Button icon="send" onPress={() => setAsking(true)}>
                {strings.resendInvite}
              </Button>
              {invite.isExpired !== true && (
                <Button variant="ghost" onPress={() => setRevoking(self)}>
                  {strings.revokeInvite}
                </Button>
              )}
            </ButtonGroup>
          }
        />
      )}
      {isAsking && (
        <PageInviteDialog
          data={data}
          slug={slug}
          page={self}
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
                    action: { label: strings.resendInvite, onAction: () => setAsking(true) },
                  },
            );
          }}
        />
      )}
      <CancelPageInvite
        data={data}
        slug={slug}
        page={revoking}
        kind="own"
        onClose={() => setRevoking(undefined)}
        onCancelled={(gone) => {
          setRevoking(undefined);
          const { invite: _gone, ...rest } = login;
          setLogin(rest);
          toasts.toast({ tone: 'success', message: strings.inviteRevoked(gone.invite?.email ?? '') });
        }}
      />
    </>
  );
}
