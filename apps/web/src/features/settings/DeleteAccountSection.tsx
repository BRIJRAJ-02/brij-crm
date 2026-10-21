// Brief
// Purpose: Account › Security's danger zone (spec 0033, AC-902 to AC-907): delete your own account.
// Main task: see what stands in the way (workspaces you are the last owner of), then confirm with your email and a step up.
// Leaves out: deleting a workspace or handing ownership on (each workspace's Members settings), and any grace window.
import { isDataError, type AccountSecurityState, type DataLayer, type DeletionBlocker } from '@crm/data';
import { Button, Callout, Card, Field, Link, Modal, SettingsRow, SettingsSection } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { signInHref } from '../auth/redirect.ts';
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

/** The danger zone: one row, and the danger Modal that checks, asks for the email and a step up, then deletes. */
export function DeleteAccountSection({ data, security }: DeleteAccountSectionProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [ready, setReady] = useState<Ready | undefined>(undefined);
  const [checkFailed, setCheckFailed] = useState(false);
  const [typed, setTyped] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // Enter and a complete code can land in one tick: only one run at a time.
  const running = useRef(false);
  const twoFactorOn = security.status === 'ready' && security.twoFactor.on;
  const commit = useRef<() => void>(() => undefined);
  const emailField = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const stepUp = useStepUp(data, security, { secondFactor: twoFactorOn, onComplete: () => commit.current() });

  const check = () => {
    setCheckFailed(false);
    setReady(undefined);
    void Promise.all([data.me.get(), data.account.deletion.check()]).then(
      ([me, found]) => {
        setReady({ email: me?.user.email ?? '', blockers: found.blockers });
      },
      () => {
        setCheckFailed(true);
      },
    );
  };

  const open = () => {
    setTyped('');
    setError(undefined);
    stepUp.reset();
    setIsOpen(true);
    check();
  };

  const matches = ready !== undefined && typed.trim().toLowerCase() === ready.email.toLowerCase();
  const remove = async () => {
    if (!matches || running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (!(await stepUp.prove())) return;
      setDeleting(true);
      await data.account.deletion.confirm(typed.trim());
      void navigate({ href: signInHref('/', 'deleted'), replace: true });
    } catch (failure) {
      const code = isDataError(failure) ? failure.code : undefined;
      // The check ran out meanwhile, or wants the second factor: read the state again, so the fields ask for it.
      if (code === 'STEP_UP_REQUIRED' || code === 'SECOND_FACTOR_REQUIRED') void data.account.security().reload();
      setError(isDataError(failure) && code !== 'INTERNAL' ? failure.message : copy.deleteFailed);
    } finally {
      running.current = false;
      setBusy(false);
      setDeleting(false);
    }
  };
  useEffect(() => {
    commit.current = () => void remove();
  });
  // Once the check says nothing stands in the way, the task begins at the email: focus goes there, which also reads
  // its label to a screen reader.
  const canConfirm = ready !== undefined && ready.blockers.length === 0;
  useEffect(() => {
    if (canConfirm) emailField.current?.focus();
  }, [canConfirm]);

  const blocked = ready !== undefined && ready.blockers.length > 0;
  let body;
  if (checkFailed) {
    body = (
      <Callout tone="danger" actions={<Button onPress={check}>{copy.tryAgain}</Button>}>
        {copy.failed}
      </Callout>
    );
  } else if (ready === undefined) {
    body = copy.checking;
  } else if (blocked) {
    body = (
      <Callout
        tone="warning"
        title={copy.blockedTitleOne}
        isAnnounced
        actions={ready.blockers.map((each) => (
          <Link key={each.slug} href={membersSettingsHref(each.slug)}>
            {copy.openMembers(each.name)}
          </Link>
        ))}
      >
        {copy.blockedText(ready.blockers.map((each) => each.name))}
      </Callout>
    );
  } else {
    body = (
      <>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {copy.text}
        <Field
          label={copy.emailLabel(ready.email)}
          type="email"
          value={typed}
          onChange={setTyped}
          autoComplete="off"
          ref={emailField}
          onSubmit={() => void remove()}
        />
        {stepUp.fields}
      </>
    );
  }

  let label: string = copy.action;
  if (isDeleting) label = copy.deleting;
  else if (stepUp.willSend) label = strings.stepUp.send;
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
        title={blocked ? copy.blockedTitleOne : copy.title}
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
                {label}
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
