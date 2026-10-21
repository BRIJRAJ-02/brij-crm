// Brief
// Purpose: Account › Security's passkeys (spec 0033, milestone 3, AC-887): sign in with a fingerprint, face or PIN.
// Main task: add a passkey (after a check, with an optional name), rename one, or remove one after a confirm.
// Leaves out: signing in with one (the sign in page), and the workspace's two factor requirement (milestone 4).
import { PASSKEY_NAME_MAX, type AccountPasskey, type AccountSecurityState, type DataLayer } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  InfoTip,
  Modal,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type Toasts,
} from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { strings } from './security-strings.ts';
import { useStepUp } from './StepUp.tsx';

const copy = strings.passkeys;

/** A passkey's name, or the word for one never named. */
export const passkeyName = (passkey: AccountPasskey): string => passkey.name ?? copy.unnamed;

/** "Added 20 Oct 2026. Last used 22 Oct 2026." in the person's own date format. */
export function passkeyLine(passkey: AccountPasskey, locale?: string): string {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const added = copy.added(date.format(new Date(passkey.createdAt)));
  return passkey.lastUsedAt === undefined
    ? `${added} ${copy.neverUsed}`
    : `${added} ${copy.lastUsed(date.format(new Date(passkey.lastUsedAt)))}`;
}

type Dialog =
  | { readonly kind: 'add' }
  | { readonly kind: 'rename'; readonly passkey: AccountPasskey }
  | { readonly kind: 'remove'; readonly passkey: AccountPasskey };

/** Props for the passkeys section. */
export interface PasskeysSectionProps {
  readonly data: DataLayer;
  readonly security: AccountSecurityState;
  readonly toasts: Toasts;
  /** Where focus goes when the button that opened a dialog went with its change (a removed row). */
  readonly onFocusLost: () => void;
}

/** The passkeys section and its three dialogs: add, rename, remove. */
export function PasskeysSection({ data, security, toasts, onFocusLost }: PasskeysSectionProps) {
  const [dialog, setDialog] = useState<Dialog>({ kind: 'add' });
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  // Whether this browser can make a passkey at all: read once, off until known.
  const [supported, setSupported] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void data.account.passkeys
      .support()
      .then((support) => {
        if (live) setSupported(support.available);
      })
      .catch(() => {
        if (live) setSupported(false);
      });
    return () => {
      live = false;
    };
  }, [data]);

  const twoFactorOn = security.status === 'ready' && security.twoFactor.on;
  // A passkey signs in alone, so adding or removing one takes a second factor while two factor is on.
  const proveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const commitRef = useRef<() => void>(() => undefined);
  const stepUp = useStepUp(data, security, { secondFactor: twoFactorOn, onComplete: () => commitRef.current() });
  useEffect(() => {
    proveRef.current = stepUp.prove;
  });

  const open = (next: Dialog) => {
    setDialog(next);
    setError(undefined);
    setName(next.kind === 'rename' ? (next.passkey.name ?? '') : '');
    stepUp.reset();
    setIsOpen(true);
  };
  const close = () => {
    if (!isBusy) setIsOpen(false);
  };

  const add = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!(await proveRef.current())) return;
      const trimmed = name.trim();
      const outcome = await data.account.passkeys.add(trimmed === '' ? undefined : trimmed);
      // Closing the browser's prompt leaves the dialog as it was, to try again.
      if (outcome === 'cancelled') return;
      setIsOpen(false);
      toasts.toast({ tone: 'success', message: copy.added_ });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.addFailed);
    } finally {
      setBusy(false);
    }
  };

  const rename = async (passkey: AccountPasskey) => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(copy.nameMissing);
      return;
    }
    // Shown at once; the data layer puts the old name back with the reason if refused.
    setIsOpen(false);
    const answer = await data.account.passkeys.rename(passkey.id, trimmed);
    if (!answer.ok) toasts.toast({ tone: 'danger', message: answer.message });
  };

  const remove = async (passkey: AccountPasskey) => {
    setBusy(true);
    setError(undefined);
    if (!(await proveRef.current())) {
      setBusy(false);
      return;
    }
    const answer = await data.account.passkeys.remove(passkey.id);
    setBusy(false);
    if (answer.ok) {
      setIsOpen(false);
      onFocusLost();
      toasts.toast({ tone: 'success', message: copy.removed(passkeyName(passkey)) });
    } else if (answer.code === 'STEP_UP_REQUIRED' || answer.code === 'SECOND_FACTOR_REQUIRED') {
      // The check ran out meanwhile: read the state again, so the dialog asks for it inline.
      void data.account.security().reload();
    } else {
      setError(answer.message);
    }
  };

  useEffect(() => {
    commitRef.current = () => {
      if (isBusy) return;
      if (dialog.kind === 'add') void add();
      else if (dialog.kind === 'remove') void remove(dialog.passkey);
    };
  });

  let card;
  if (security.status === 'loading') {
    card = (
      <Card isBusy>
        <Skeleton width="long" />
      </Card>
    );
  } else if (security.status === 'error') {
    card = (
      <EmptyState tone="error" title={copy.failedTitle} onRetry={() => void data.account.security().reload()}>
        {security.message}
      </EmptyState>
    );
  } else {
    const addButton = (
      <Button
        variant={security.passkeys.length === 0 ? 'primary' : 'secondary'}
        icon="plus"
        isDisabled={supported !== true}
        onPress={() => open({ kind: 'add' })}
      >
        {copy.add}
      </Button>
    );
    card = (
      <Card>
        {security.passkeys.map((passkey) => (
          <SettingsRow key={passkey.id} title={passkeyName(passkey)} description={passkeyLine(passkey)}>
            <Button label={copy.renameLabel(passkeyName(passkey))} onPress={() => open({ kind: 'rename', passkey })}>
              {copy.rename}
            </Button>
            <Button
              variant="danger"
              label={copy.removeLabel(passkeyName(passkey))}
              onPress={() => open({ kind: 'remove', passkey })}
            >
              {copy.remove}
            </Button>
          </SettingsRow>
        ))}
        <SettingsRow
          title={security.passkeys.length === 0 ? copy.none : copy.another}
          description={supported === false ? copy.unsupported : copy.addText}
        >
          {addButton}
        </SettingsRow>
      </Card>
    );
  }

  const errorNote = error === undefined ? null : <Callout tone="danger">{error}</Callout>;
  let modal;
  if (dialog.kind === 'add') {
    modal = (
      <Modal
        title={copy.addTitle}
        isOpen={isOpen}
        isBusy={isBusy}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC" isDisabled={isBusy}>
              {copy.cancel}
            </Button>
            <Button variant="primary" isPending={isBusy} onPress={() => commitRef.current()}>
              {isBusy ? copy.adding : stepUp.willSend ? strings.stepUp.send : copy.continue}
            </Button>
          </>
        }
      >
        {errorNote}
        {copy.addDialogText}
        <Field
          label={copy.nameLabel}
          hint={copy.nameHint}
          placeholder={copy.namePlaceholder}
          value={name}
          onChange={setName}
          maxLength={PASSKEY_NAME_MAX}
          autoComplete="off"
          onSubmit={() => commitRef.current()}
        />
        {stepUp.fields}
      </Modal>
    );
  } else if (dialog.kind === 'rename') {
    const passkey = dialog.passkey;
    modal = (
      <Modal
        title={copy.renameTitle}
        isOpen={isOpen}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC">
              {copy.cancel}
            </Button>
            <Button variant="primary" onPress={() => void rename(passkey)}>
              {copy.save}
            </Button>
          </>
        }
      >
        <Field
          label={copy.nameLabel}
          value={name}
          onChange={(next) => {
            setName(next);
            setError(undefined);
          }}
          maxLength={PASSKEY_NAME_MAX}
          autoComplete="off"
          onSubmit={() => void rename(passkey)}
          {...(error === undefined ? {} : { error })}
        />
      </Modal>
    );
  } else {
    const passkey = dialog.passkey;
    modal = (
      <Modal
        title={copy.removeTitle(passkeyName(passkey))}
        tone="danger"
        isOpen={isOpen}
        isBusy={isBusy}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC" isDisabled={isBusy}>
              {copy.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isBusy} onPress={() => commitRef.current()}>
              {isBusy ? copy.removing : stepUp.willSend ? strings.stepUp.send : copy.remove}
            </Button>
          </>
        }
      >
        {errorNote}
        {copy.removeText}
        {stepUp.fields}
      </Modal>
    );
  }

  return (
    <SettingsSection
      title={copy.section}
      description={
        <>
          {copy.description} <InfoTip label={copy.section}>{copy.info}</InfoTip>
        </>
      }
    >
      {card}
      {modal}
    </SettingsSection>
  );
}
