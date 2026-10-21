// Brief
// Purpose: Account › Security's danger zone (spec 0033, AC-902 to AC-907): delete your own account.
// Main task: see what stands in the way (workspaces you are the last owner of), then confirm with a step up and your email.
// Leaves out: deleting a workspace or handing ownership on (each workspace's Members settings), and any grace window.
import { isDataError, type AccountSecurityState, type DataLayer, type DeletionBlocker } from '@crm/data';
import { Button, Callout, Card, Field, Link, Modal, SettingsRow, SettingsSection } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { membersSettingsHref } from './nav.ts';
import { strings } from './security-strings.ts';
import { useStepUp } from './StepUp.tsx';

const copy = strings.deletion;

/** Props for the danger zone. */
export interface DeleteAccountSectionProps {
  readonly data: DataLayer;
  readonly security: AccountSecurityState;
}

/** What the confirm learned when it opened: who is signed in, and the workspaces in the way. */
type Ready = { readonly email: string; readonly blockers: readonly DeletionBlocker[] };

/** The danger zone: one row, and the danger Modal that checks, asks for a step up and the email, then deletes. */
export function DeleteAccountSection({ data, security }: DeleteAccountSectionProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [ready, setReady] = useState<Ready | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const twoFactorOn = security.status === 'ready' && security.twoFactor.on;
  const commit = useRef<() => void>(() => undefined);
  const stepUp = useStepUp(data, security, { secondFactor: twoFactorOn, onComplete: () => commit.current() });

  const open = () => {
    setReady(undefined);
    setTyped('');
    setError(undefined);
    stepUp.reset();
    setIsOpen(true);
    void Promise.all([data.me.get(), data.account.deletion.check()]).then(
      ([me, check]) => {
        setReady({ email: me?.user.email ?? '', blockers: check.blockers });
      },
      () => {
        setError(copy.failed);
      },
    );
  };

  const matches = ready !== undefined && typed.trim().toLowerCase() === ready.email.toLowerCase();
  const remove = async () => {
    if (!matches || isBusy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!(await stepUp.prove())) return;
      await data.account.deletion.confirm(typed.trim());
      void navigate({ to: '/sign-in', replace: true });
    } catch (failure) {
      setError(isDataError(failure) ? failure.message : copy.failed);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    commit.current = () => void remove();
  });

  const blocked = ready !== undefined && ready.blockers.length > 0;
  let body;
  if (ready === undefined) {
    body = error === undefined ? copy.checking : <Callout tone="danger">{error}</Callout>;
  } else if (blocked) {
    body = (
      <Callout
        tone="warning"
        title={copy.blockedTitle}
        isAnnounced
        actions={ready.blockers.map((each) => (
          <Link key={each.slug} href={membersSettingsHref(each.slug)}>
            {copy.openMembers(each.name)}
          </Link>
        ))}
      >
        {copy.blockedText}
      </Callout>
    );
  } else {
    body = (
      <>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {copy.text}
        <Callout>{copy.exportFirst}</Callout>
        {stepUp.fields}
        <Field
          label={copy.emailLabel}
          type="email"
          value={typed}
          onChange={setTyped}
          placeholder={ready.email}
          autoComplete="off"
          onSubmit={() => void remove()}
        />
      </>
    );
  }

  return (
    <SettingsSection title={copy.section} description={copy.description}>
      <Card>
        <SettingsRow title={copy.row} description={copy.rowText}>
          <Button variant="danger" onPress={open}>
            {copy.action}
          </Button>
        </SettingsRow>
      </Card>
      <Modal
        title={copy.title}
        tone="danger"
        isOpen={isOpen}
        isBusy={isBusy}
        onOpenChange={(next) => {
          if (!next && !isBusy) setIsOpen(false);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC" isDisabled={isBusy}>
              {blocked ? copy.close : copy.cancel}
            </Button>
            {ready !== undefined && !blocked && (
              <Button variant="danger-solid" isPending={isBusy} isDisabled={!matches} onPress={() => void remove()}>
                {isBusy ? copy.deleting : copy.action}
              </Button>
            )}
          </>
        }
      >
        {body}
      </Modal>
    </SettingsSection>
  );
}
