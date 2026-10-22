// Brief
// Purpose: the page an invitation email links to (spec 0031, AC-805): who invited you to which workspace, as what.
// Main task: Join workspace when signed in, or Sign in to join, which brings you back here.
// Leaves out: the invite link and domain joins (slice 6), and making an account here (sign in does that).
// Look: first run's split card (spec 0036), lean: one line, one action, and the workspace sketched beside it.
import { isDataError, ROLE_LABELS, type DataLayer, type InvitePeek, type SignedInUser } from '@crm/data';
import { AuthLayout, Button, ButtonLink, Callout, WorkspacePreview } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { PRODUCT_LOGO } from '../../brand.ts';
import { signInFrame } from '../auth/AuthStates.tsx';
import { signInHref } from '../auth/redirect.ts';
import { SignOutDialog } from '../auth/SignOutDialog.tsx';
import { strings } from './strings.ts';
/** Props for the invitation page: what its route loaded. */
export interface InviteScreenProps {
  readonly data: DataLayer;
  readonly token: string;
  /** The invitation as the link shows it; undefined when the link opens nothing (expired, revoked, used, unknown). */
  readonly invitation: InvitePeek | undefined;
  /** Who is signed in, if anyone. */
  readonly user: SignedInUser | undefined;
}

/**
 * Where the page stands: ready to act, joining, or refused (another address,
 * a full plan, a failure), each with what the server said.
 */
type Standing =
  | { readonly kind: 'ready' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'mismatch'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

/** The invitation page: AuthLayout, the invitation, and the one action that fits who is here. */
export function InviteScreen({ data, token, invitation, user }: InviteScreenProps) {
  const navigate = useNavigate();
  const [standing, setStanding] = useState<Standing>({ kind: 'ready' });
  // Signing in with another address signs this one out first, so it asks first (the owner's rule of 21 October 2026).
  const [confirming, setConfirming] = useState(false);
  // Its own flag, so a failed sign out leaves the card (and a refusal on it) as it was.
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailure, setSignOutFailure] = useState<string | undefined>(undefined);
  const here = `/invite/${token}`;

  // Expired, revoked, used and unknown links all read the same (AC-805), before or after a try.
  if (invitation === undefined || standing.kind === 'invalid') {
    return (
      <AuthLayout
        productName={strings.product}
        logo={PRODUCT_LOGO}
        title={strings.invalidTitle}
        description={strings.invalidText}
        {...signInFrame()}
      >
        <ButtonLink size="lg" isFullWidth="center" href="/">
          {strings.goHome}
        </ButtonLink>
      </AuthLayout>
    );
  }

  const isBusy = standing.kind === 'busy';

  const accept = () => {
    if (isBusy) return;
    setStanding({ kind: 'busy' });
    data.invitations.accept(token).then(
      ({ slug }) => {
        void navigate({ to: '/w/$slug', params: { slug }, replace: true });
      },
      (failure: unknown) => {
        if (isDataError(failure) && failure.code === 'INVITE_INVALID') {
          setStanding({ kind: 'invalid' });
          return;
        }
        if (isDataError(failure) && failure.code === 'INVITE_EMAIL_MISMATCH') {
          setStanding({ kind: 'mismatch', message: failure.message });
          return;
        }
        setStanding({ kind: 'refused', message: isDataError(failure) ? failure.message : strings.somethingWrong });
      },
    );
  };

  // Signing out first, so sign in starts clean and comes back here as the invited address.
  const signInAgain = () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutFailure(undefined);
    data.auth.signOut().then(
      () => {
        void navigate({ href: signInHref(here), replace: true });
      },
      () => {
        setSigningOut(false);
        setSignOutFailure(strings.signOutFailed);
      },
    );
  };
  const askSignInAgain = () => {
    setSignOutFailure(undefined);
    setConfirming(true);
  };

  const role = ROLE_LABELS[invitation.role];
  const isMismatch = standing.kind === 'mismatch';
  const message =
    standing.kind === 'mismatch' || standing.kind === 'refused' ? (
      <Callout tone="danger">{standing.message}</Callout>
    ) : null;
  // One line on who and as what, and whom it is for: the title already names the workspace.
  // Signed in, "Signed in as" says whose this is (the wrong address answers with its own message).
  const about = [
    strings.invited(invitation.inviterName, role),
    user === undefined ? strings.forAddress(invitation.invitedEmailMasked) : '',
  ]
    .filter((line) => line !== '')
    .join(' ');
  return (
    <>
      <AuthLayout
        productName={strings.product}
        logo={PRODUCT_LOGO}
        title={strings.title(invitation.workspaceName)}
        description={about}
        // First run's split card, the workspace they are joining beside it (the auth lane).
        preview={
          <WorkspacePreview
            workspaceName={invitation.workspaceName}
            personName={user?.name ?? ''}
            {...(user === undefined ? {} : { personId: user.id })}
            focus="workspace"
          />
        }
        {...(user === undefined || isMismatch
          ? {}
          : {
              footer: (
                <Button variant="ghost" onPress={askSignInAgain} isDisabled={isBusy || signingOut}>
                  {strings.useAnother}
                </Button>
              ),
            })}
      >
        {message}
        {user === undefined ? (
          <>
            <ButtonLink variant="primary" size="lg" isFullWidth="center" href={signInHref(here)}>
              {strings.signInToAccept}
            </ButtonLink>
            <p>{strings.newHere}</p>
          </>
        ) : isMismatch ? (
          <>
            <p>{strings.signedInAs(user.email)}</p>
            <Button variant="primary" size="lg" isFullWidth="center" onPress={askSignInAgain}>
              {strings.useAnother}
            </Button>
          </>
        ) : (
          <>
            <p>{strings.signedInAs(user.email)}</p>
            <Button variant="primary" size="lg" isFullWidth="center" onPress={accept} isPending={isBusy}>
              {strings.accept}
            </Button>
          </>
        )}
      </AuthLayout>
      <SignOutDialog
        isOpen={confirming}
        isBusy={signingOut}
        text={strings.signOutText}
        failure={signOutFailure}
        onSignOut={signInAgain}
        onClose={() => {
          setConfirming(false);
        }}
      />
    </>
  );
}
