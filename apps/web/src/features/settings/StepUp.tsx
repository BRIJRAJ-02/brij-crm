// Brief
// Purpose: the step up (spec 0033, AC-896), asked inline in a sensitive change's own dialog, then the change goes on.
// Main task: enter the authenticator app's code (or a backup code) when two factor is on, else a code emailed now.
// Leaves out: its own dialog (each change's dialog holds these fields) and passkeys (milestone 3).
import type { AccountSecurityState, DataLayer } from '@crm/data';
import { Button, Callout, CodeInput, Field } from '@crm/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { strings } from './security-strings.ts';

/** What a step up needs: a recent check, and for turning two factor off or new codes, a second factor's. */
export interface StepUpNeed {
  readonly secondFactor?: boolean;
  /** The dialog's commit, run when a code is complete (the boxes filled), as Enter would. */
  readonly onComplete?: () => void;
}

/** A step up's state inside a dialog: whether it is needed, its fields, and `prove`, which checks what was typed. */
export interface StepUp {
  readonly isNeeded: boolean;
  /** The sentence saying why, then the code's field and the way to switch: siblings in the dialog's body. */
  readonly fields: ReactNode;
  /** Checks the typed code when a step up is needed; true when the change may go on. */
  readonly prove: () => Promise<boolean>;
  /** Clears what was typed (the dialog opened again). */
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
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // A new field (a code just sent, the other kind chosen) or a refused code: the field takes focus again.
  const [focusAsked, setFocusAsked] = useState(0);
  useEffect(() => {
    if (focusAsked > 0) field.current?.focus();
  }, [focusAsked]);
  const refocus = () => setFocusAsked((count) => count + 1);

  const reset = () => {
    setKind('totp');
    setCode('');
    setError(undefined);
    setSent(false);
  };

  const send = async () => {
    setSending(true);
    setError(undefined);
    const answer = await data.account.stepUp.sendCode();
    setSending(false);
    if (answer.ok) {
      setSent(true);
      refocus();
    } else {
      setError(answer.message);
    }
  };

  const prove = async (): Promise<boolean> => {
    if (!isNeeded) return true;
    if (!twoFactorOn && !sent) {
      // The commit with no code sent yet sends one: the next step is the code.
      await send();
      return false;
    }
    const typed = code.trim();
    if (typed === '' || (kind === 'totp' && twoFactorOn && typed.length < 6)) {
      setError(strings.stepUp.missing);
      refocus();
      return false;
    }
    const answer = await data.account.stepUp.verify(twoFactorOn ? kind : 'email', typed);
    if (answer.ok) {
      reset();
      return true;
    }
    setError(answer.message);
    setCode('');
    refocus();
    return false;
  };

  const errorProps = error === undefined ? {} : { error };
  const complete = need.onComplete === undefined ? {} : { onComplete: () => need.onComplete?.() };
  let fields: ReactNode = null;
  if (isNeeded && twoFactorOn) {
    fields = (
      <>
        <Callout title={strings.stepUp.title}>
          {kind === 'totp' ? strings.stepUp.withApp : strings.stepUp.withBackup}
        </Callout>
        {kind === 'totp' ? (
          <CodeInput
            ref={field}
            label={strings.stepUp.appLabel}
            value={code}
            onChange={setCode}
            {...complete}
            {...errorProps}
          />
        ) : (
          <Field
            ref={field}
            label={strings.stepUp.backupLabel}
            value={code}
            onChange={setCode}
            autoComplete="off"
            onSubmit={() => need.onComplete?.()}
            {...errorProps}
          />
        )}
        <Button
          variant="ghost"
          onPress={() => {
            setKind(kind === 'totp' ? 'backup' : 'totp');
            setCode('');
            setError(undefined);
            refocus();
          }}
        >
          {kind === 'totp' ? strings.stepUp.useBackup : strings.stepUp.useApp}
        </Button>
      </>
    );
  } else if (isNeeded && need.secondFactor === true) {
    fields = <Callout title={strings.stepUp.title}>{strings.stepUp.secondFactorOnly}</Callout>;
  } else if (isNeeded) {
    fields = (
      <>
        <Callout title={strings.stepUp.title} isAnnounced>
          {sent ? strings.stepUp.sent : strings.stepUp.withEmail}
        </Callout>
        {sent ? (
          <>
            <CodeInput
              ref={field}
              label={strings.stepUp.emailLabel}
              value={code}
              onChange={setCode}
              {...complete}
              {...errorProps}
            />
            <Button variant="ghost" isPending={isSending} onPress={() => void send()}>
              {strings.stepUp.sendAgain}
            </Button>
          </>
        ) : (
          error !== undefined && <Callout tone="danger">{error}</Callout>
        )}
      </>
    );
  }
  return { isNeeded, fields, prove, reset };
}
