// Brief
// Purpose: show a signed in person the workspaces at their email's domain they may ask to join (spec 0031, AC-819).
// Main task: Ask to join one; it then says the request was sent, and an email follows once an admin approves.
// Leaves out: joining at once (an admin approves each request), other domains, and invitations (their own page).
import { isDataError, type DataLayer, type Joinable } from '@crm/data';
import { AuthLayout, Badge, Button, ButtonLink, Callout, DescriptionList } from '@crm/ui';
import { useState } from 'react';
import { PRODUCT_LOGO } from '../../brand.ts';
import { strings } from './strings.ts';

/** Props for `/join`: what its route loaded. */
export interface JoinScreenProps {
  readonly data: DataLayer;
  /** The signed in person's address, for its domain. */
  readonly email: string;
  readonly joinable: readonly Joinable[];
}

/** The domain of an address, for the copy. */
const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/**
 * AuthLayout with one row per workspace (DescriptionList: its name, then Ask
 * to join or the request's Badge), a quiet line once any request is out, and
 * the way back to the person's workspaces.
 */
export function JoinScreen({ data, email, joinable }: JoinScreenProps) {
  const [rows, setRows] = useState(joinable);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const domain = domainOf(email);

  const ask = (workspace: Joinable) => {
    if (busy !== undefined) return;
    setBusy(workspace.workspaceId);
    setFailure(undefined);
    data.join.request(workspace.workspaceId).then(
      (answered) => {
        setBusy(undefined);
        setRows((current) => current.map((row) => (row.workspaceId === answered.workspaceId ? answered : row)));
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
      footer={
        <ButtonLink variant="ghost" href="/">
          {strings.goHome}
        </ButtonLink>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {rows.length > 0 && (
        <DescriptionList
          items={rows.map((row) => ({
            term: row.name,
            description:
              row.state === 'pending' ? (
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
              ),
          }))}
        />
      )}
      {rows.some((row) => row.state === 'pending') && <p>{strings.pendingNote}</p>}
    </AuthLayout>
  );
}
