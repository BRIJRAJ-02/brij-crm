// Brief
// Purpose: the page a page's hand over links to (Team pages, 9 Nov 2026): someone made Nick's link page and invited
// him to manage it; here Nick sets up his login and then signs in to it.
// Main task: Set up my login (no sign in first: it makes the page's own identity a login at the invited address), then
// Sign in with that address, which is filled in for him.
// Leaves out: joining as a new member (the invitation is for the person who already has the page), roles, and any
// other account: one already signed in signs out first, since a page never moves into another login.
// The same card sets up a connected app's person's own Timefix login (spec 0070, AC-7023), in that case's words: the
// app keeps managing them.
import { isDataError, type DataLayer, type InvitePeek, type SignedInUser } from '@crm/data';
import { AuthLayout, Button, Callout, sharedStrings } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { PRODUCT_LOGO } from '../../brand.ts';
import { publicBookingHost } from '../booking/links.ts';
import { signInFrame } from '../auth/AuthStates.tsx';
import { saveLastEmail, sessionStore } from '../auth/pending.ts';
import { signInHref } from '../auth/redirect.ts';
import { SignOutDialog } from '../auth/SignOutDialog.tsx';
import { strings } from './strings.ts';

/** Props for a page's hand over. */
export interface PageInviteCardProps {
  readonly data: DataLayer;
  readonly token: string;
  /** The invitation as the link shows it, with the page it hands over. */
  readonly invitation: InvitePeek & { readonly page: NonNullable<InvitePeek['page']> };
  /** Who is signed in, if anyone: they sign out first. */
  readonly user: SignedInUser | undefined;
  /** The link opened nothing when tried (used, expired, cancelled): the invalid page. */
  readonly onInvalid: () => void;
}

/**
 * Where the card stands: ready, setting up, done (sign in next, into the workspace when known), refused with the
 * server's words (`isFinal` when pressing again can't help), or signing out.
 */
type Standing =
  | { readonly kind: 'ready' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly slug?: string }
  | { readonly kind: 'refused'; readonly message: string; readonly isFinal: boolean };

/**
 * AuthLayout with one line on whose page it is and who invited them, and one action: Set up my login, then, once it
 * stands, Sign in (to the workspace afterwards, the address filled in). A link opened again once it was taken starts
 * at Sign in. Signed in already, the action is Sign out, which asks first and comes back here signed out.
 */
export function PageInviteCard({ data, token, invitation, user, onInvalid }: PageInviteCardProps) {
  const navigate = useNavigate();
  const [standing, setStanding] = useState<Standing>(
    invitation.isClaimed === true ? { kind: 'done' } : { kind: 'ready' },
  );
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailure, setSignOutFailure] = useState<string | undefined>(undefined);
  const here = `/invite/${token}`;
  const masked = invitation.invitedEmailMasked;
  const handle = invitation.page.handle;
  const address = handle === undefined ? undefined : `${publicBookingHost()}/${handle}`;
  const login = invitation.login;

  const claim = () => {
    if (standing.kind === 'busy') return;
    setStanding({ kind: 'busy' });
    data.invitations.claimPage(token).then(
      ({ slug, email }) => {
        // Sign in starts from the invited address, so all that is left is the code.
        saveLastEmail(sessionStore(window), email);
        setStanding({ kind: 'done', slug });
      },
      (failure: unknown) => {
        if (isDataError(failure) && failure.code === 'INVITE_INVALID') {
          onInvalid();
          return;
        }
        setStanding({
          kind: 'refused',
          message: isDataError(failure) ? failure.message : sharedStrings.couldntDoThat,
          // The address has a login of its own, or someone here uses it: pressing again says the same.
          isFinal: isDataError(failure) && failure.code === 'UNIQUE_CONFLICT',
        });
      },
    );
  };

  // Signing out first, then this page again, signed out, so the login set up here is the page's own.
  const signOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutFailure(undefined);
    data.auth.signOut().then(
      () => {
        setConfirming(false);
        setSigningOut(false);
        void navigate({ href: here, replace: true });
      },
      () => {
        setSigningOut(false);
        setSignOutFailure(strings.signOutFailed);
      },
    );
  };

  if (standing.kind === 'done') {
    return (
      <AuthLayout
        productName={strings.product}
        logo={PRODUCT_LOGO}
        title={strings.pageReadyTitle}
        description={login === undefined ? strings.pageReadyText(masked) : strings.loginReadyText(masked)}
        {...signInFrame()}
      >
        <Button
          variant="primary"
          size="lg"
          isFullWidth="center"
          // The button that set it up is gone: focus goes to what is next, so a keyboard or a screen reader follows.
          // eslint-disable-next-line jsx-a11y-x/no-autofocus
          autoFocus
          onPress={() => {
            void navigate({ href: signInHref(standing.slug === undefined ? '/' : `/w/${standing.slug}`) });
          }}
        >
          {strings.signIn}
        </Button>
      </AuthLayout>
    );
  }

  const isBusy = standing.kind === 'busy';
  // Whose page, from whom, and (signed out) the address it was sent to: the title says what to do.
  const about = [
    login === undefined
      ? strings.pageInvited(invitation.inviterName, address, invitation.workspaceName)
      : strings.loginInvited(invitation.inviterName, invitation.workspaceName, login.app),
    user === undefined ? strings.forAddress(masked) : '',
  ];
  return (
    <>
      <AuthLayout
        productName={strings.product}
        logo={PRODUCT_LOGO}
        title={login === undefined ? strings.pageTitle : strings.loginTitle}
        description={about.filter((line) => line !== '').join(' ')}
        {...signInFrame()}
      >
        {standing.kind === 'refused' && <Callout tone="danger">{standing.message}</Callout>}
        {user === undefined ? (
          standing.kind === 'refused' && standing.isFinal ? null : (
            <Button variant="primary" size="lg" isFullWidth="center" isPending={isBusy} onPress={claim}>
              {isBusy ? strings.settingUp : strings.setUpLogin}
            </Button>
          )
        ) : (
          <>
            <p>{login === undefined ? strings.pageSignedIn(user.email) : strings.loginSignedIn(user.email)}</p>
            <Button
              variant="primary"
              size="lg"
              isFullWidth="center"
              onPress={() => {
                setSignOutFailure(undefined);
                setConfirming(true);
              }}
            >
              {strings.signOut}
            </Button>
          </>
        )}
      </AuthLayout>
      <SignOutDialog
        isOpen={confirming}
        isBusy={signingOut}
        text={strings.pageSignOutText}
        failure={signOutFailure}
        onSignOut={signOut}
        onClose={() => {
          setConfirming(false);
        }}
      />
    </>
  );
}
