// Brief
// Purpose: the step up (spec 0033, AC-896), asked inline in a sensitive change's own dialog, then the change goes on.
// Main task: enter the authenticator app's code (or a backup code) when two factor is on, else a code emailed now.
// Leaves out: its own dialog (each change's dialog holds these fields) and passkeys (milestone 3).
import type { AccountSecurityState, DataLayer } from '@crm/data';
import { Button, Callout, CodeInput, Field } from '@crm/ui';
import { useState } from 'react';
import { strings } from './security-strings.ts';

/** What a step up needs: a recent check, and for turning two factor off or new codes, a second factor's. */
export interface StepUpNeed {
  readonly secondFactor?: boolean;
}

/** A step up's state inside a dialog: whether it is needed, its fields, and `prove`, which checks what was typed. */
export interface StepUp {
  readonly isNeeded: boolean;
  readonly fields: React.ReactNode;
  /** Checks the typed code when a step up is needed; true when the change may go on. */
  readonly prove: () => Promise<boolean>;
  /** Clears what was typed (the dialog closed). */
  readonly reset: () => void;
}

/** Whether this session must step up before the change. */
export function needsStepUp(data: DataLayer, security: AccountSecurityState, need: StepUpNeed = {}): boolean {
  if (security.status !== 'ready') return true;
  if (!data.account.isFresh(security)) return true;
  return need.secondFactor === true && !security.session.withSecondFactor;
}

/** The step up's fields and checks for one dialog. */
export function useStepUp(data: DataLayer, security: AccountSecurityState, need: StepUpNeed = {}): StepUp {
  const twoFactorOn = security.status === 'ready' && security.twoFactor.on;
  const isNeeded = needsStepUp(data, security, need);
  const [kind, setKind] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState(false);
  const [isSending, setSending] = useState(false);

  const reset = () => {
    setKind('totp');
    setCode('');
    setError(undefined);
    setSent(false);
  };

  const prove = async (): Promise<boolean> => {
    if (!isNeeded) return true;
    const typed = code.trim();
    if (typed === '') {
      setError(strings.stepUp.missing);
      return false;
    }
    const answer = await data.account.stepUp.verify(twoFactorOn ? kind : 'email', typed);
    if (answer.ok) {
      reset();
      return true;
    }
    setError(answer.message);
    setCode('');
    return false;
  };

  const send = async () => {
    setSending(true);
    setError(undefined);
    const answer = await data.account.stepUp.sendCode();
    setSending(false);
    if (answer.ok) setSent(true);
    else setError(answer.message);
  };

  const errorProps = error === undefined ? {} : { error };
  let fields: React.ReactNode = null;
  if (isNeeded && twoFactorOn) {
    fields = (
      <Callout title={strings.stepUp.title}>
        {kind === 'totp' ? strings.stepUp.withApp : strings.stepUp.withBackup}
        {kind === 'totp' ? (
          <CodeInput label={strings.stepUp.appLabel} isLabelHidden value={code} onChange={setCode} {...errorProps} />
        ) : (
          <Field
            label={strings.stepUp.backupLabel}
            value={code}
            onChange={setCode}
            autoComplete="off"
            {...errorProps}
          />
        )}
        <Button
          variant="ghost"
          onPress={() => {
            setKind(kind === 'totp' ? 'backup' : 'totp');
            setCode('');
            setError(undefined);
          }}
        >
          {kind === 'totp' ? strings.stepUp.useBackup : strings.stepUp.useApp}
        </Button>
      </Callout>
    );
  } else if (isNeeded && need.secondFactor === true) {
    // Two factor is off: nothing here needs a second factor then, but say so rather than show nothing.
    fields = <Callout title={strings.stepUp.title}>{strings.stepUp.secondFactorOnly}</Callout>;
  } else if (isNeeded) {
    fields = (
      <Callout title={strings.stepUp.title}>
        {sent ? strings.stepUp.sent : strings.stepUp.withEmail}
        {sent && (
          <CodeInput label={strings.stepUp.emailLabel} isLabelHidden value={code} onChange={setCode} {...errorProps} />
        )}
        {!sent && error !== undefined && <Callout tone="danger">{error}</Callout>}
        <Button variant={sent ? 'ghost' : 'secondary'} isPending={isSending} onPress={() => void send()}>
          {sent ? strings.stepUp.sendAgain : strings.stepUp.send}
        </Button>
      </Callout>
    );
  }
  return { isNeeded, fields, prove, reset };
}
