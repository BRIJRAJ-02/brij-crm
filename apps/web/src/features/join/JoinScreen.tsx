// Brief
// Purpose: show a signed in person the workspaces at their email's domain they may ask to join (spec 0031, AC-819).
// Main task: Ask to join one; it then says the request was sent, and an email follows once an admin approves.
// Leaves out: joining at once (an admin approves each request), other domains, and invitations (their own page).
import { isDataError, type DataLayer, type Joinable } from '@crm/data';
import { AuthLayout, Badge, Button, ButtonLink, Callout, Card, SettingsRow } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { PRODUCT_LOGO } from '../../brand.ts';
import { signInFrame } from '../auth/AuthStates.tsx';
import { strings } from './strings.ts';

/** Props for `/join`: what its route loaded. */
export interface JoinScreenProps {
  readonly data: DataLayer;
  /** The signed in person's address, for its domain. */
  readonly email: string;
  readonly joinable: readonly Joinable[];
  /** Whether they're in any workspace: the way out goes there, or to making one. */
  readonly hasHome: boolean;
}

/** The domain of an address, for the copy. */
const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/**
 * AuthLayout with one row per workspace (a SettingsRow in a Card: its name, then Ask
 * to join or the request's Badge), a quiet line once any request is out, and
 * the way back to the person's workspaces.
 */
export function JoinScreen({ data, email, joinable, hasHome }: JoinScreenProps) {
  const [rows, setRows] = useState(joinable);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // The workspace just asked: the status line names it, and focus moves to the way out, since the button is gone.
  const [asked, setAsked] = useState<string | undefined>(undefined);
  const footer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (asked !== undefined) footer.current?.querySelector('a')?.focus();
  }, [asked]);
  const domain = domainOf(email);
  const wayOut = hasHome ? '/' : '/welcome';
  const wayOutLabel = hasHome ? strings.goHome : strings.createOne;

  const ask = (workspace: Joinable) => {
    if (busy !== undefined) return;
    setBusy(workspace.workspaceId);
    setFailure(undefined);
    data.join.request(workspace.workspaceId).then(
      (answered) => {
        setBusy(undefined);
        setRows((current) => current.map((row) => (row.workspaceId === answered.workspaceId ? answered : row)));
        setAsked(answered.name);
      },
      (error: unknown) => {
        setBusy(undefined);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };

  return (
    <AuthLayout
      productName={strings.product}
      logo={PRODUCT_LOGO}
      title={strings.title}
      description={rows.length === 0 ? strings.none(domain) : strings.atDomain(domain)}
      {...signInFrame()}
      {...(rows.length === 0
        ? {}
        : {
            footer: (
              <div ref={footer}>
                <ButtonLink variant="ghost" href={wayOut}>
                  {wayOutLabel}
                </ButtonLink>
              </div>
            ),
          })}
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {rows.length === 0 && (
        // Nothing to ask: the way on is the page's one action, not a footer link.
        <ButtonLink variant="primary" size="lg" isFullWidth="center" href={wayOut}>
          {wayOutLabel}
        </ButtonLink>
      )}
      {rows.length > 0 && (
        <Card>
          {rows.map((row) => (
            <SettingsRow key={row.workspaceId} title={row.name}>
              {row.state === 'pending' ? (
                <Badge text={strings.pending} />
              ) : (
                <Button
                  size="sm"
                  label={strings.ask(row.name)}
                  isPending={busy === row.workspaceId}
                  isDisabled={busy !== undefined && busy !== row.workspaceId}
                  onPress={() => ask(row)}
                >
                  {strings.askShort}
                </Button>
              )}
            </SettingsRow>
          ))}
        </Card>
      )}
      {rows.some((row) => row.state === 'pending') && (
        <Callout isAnnounced {...(asked === undefined ? {} : { title: strings.asked(asked) })}>
          {strings.pendingNote}
        </Callout>
      )}
    </AuthLayout>
  );
}
