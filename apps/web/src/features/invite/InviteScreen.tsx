// Brief
// Purpose: the page an invitation email links to (spec 0031, AC-805): who invited you to which workspace, as what.
// Main task: Accept invitation when signed in, or Sign in to accept, which brings you back here.
// Leaves out: the invite link and domain joins (slice 6), and making an account here (sign in does that).
import { isDataError, ROLE_LABELS, type DataLayer, type InvitePeek, type SignedInUser } from '@crm/data';
import { AuthLayout, Button, ButtonLink, Callout, EmptyState } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { PRODUCT_LOGO } from '../../brand.ts';
import { signInHref } from '../auth/redirect.ts';
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
  const here = `/invite/${token}`;

  // Expired, revoked, used and unknown links all read the same (AC-805), before or after a try.
  if (invitation === undefined || standing.kind === 'invalid') {
    return (
      <AuthLayout productName={strings.product} logo={PRODUCT_LOGO} title={strings.invalidTitle}>
        <EmptyState
          icon="mail"
          title={strings.invalidTitle}
          actions={<ButtonLink href="/">{strings.goHome}</ButtonLink>}
        >
          {strings.invalidText}
        </EmptyState>
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
    if (isBusy) return;
    setStanding({ kind: 'busy' });
    data.auth.signOut().then(
      () => {
        void navigate({ href: signInHref(here), replace: true });
      },
      () => {
        setStanding({ kind: 'refused', message: strings.signOutFailed });
      },
    );
  };

  const role = ROLE_LABELS[invitation.role];
  const message =
    standing.kind === 'mismatch' || standing.kind === 'refused' ? (
      <Callout tone="danger">{standing.message}</Callout>
    ) : null;
  return (
    <AuthLayout
      productName={strings.product}
      logo={PRODUCT_LOGO}
      title={strings.title}
      description={strings.invited(invitation.inviterName, invitation.workspaceName, role)}
      {...(user === undefined || standing.kind === 'mismatch'
        ? {}
        : {
            footer: (
              <Button variant="ghost" onPress={signInAgain} isDisabled={isBusy}>
                {strings.useAnother}
              </Button>
            ),
          })}
    >
      {user === undefined ? (
        <>
          <p>{strings.forAddress(invitation.invitedEmailMasked)}</p>
          <p>{invitation.invitedEmailMasked === undefined ? strings.newHereLink : strings.newHere}</p>
          {message}
          <ButtonLink variant="primary" href={signInHref(here)}>
            {strings.signInToAccept}
          </ButtonLink>
        </>
      ) : (
        <>
          {/* Refused for another address, the refusal names the invited one, so it isn't said twice. */}
          <p>
            {standing.kind === 'mismatch'
              ? strings.signedInAs(user.email)
              : `${strings.forAddress(invitation.invitedEmailMasked)} ${strings.signedInAs(user.email)}`}
          </p>
          {message}
          {standing.kind === 'mismatch' ? (
            <Button variant="primary" onPress={signInAgain}>
              {strings.useAnother}
            </Button>
          ) : (
            <Button variant="primary" onPress={accept} isPending={isBusy}>
              {strings.accept}
            </Button>
          )}
        </>
      )}
    </AuthLayout>
  );
}
