// Brief
// Purpose: Account › Security's two factor sign in (spec 0033, AC-881, AC-883, AC-885): on or off, and backup codes.
// Main task: set the authenticator app up (QR code, first code, backup codes saved), turn it off, or make new codes.
// Leaves out: passkeys (milestone 3) and the workspace's requirement (milestone 4).
import type { AccountSecurityState, DataLayer } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Code,
  CodeInput,
  CopyButton,
  EmptyState,
  Field,
  InfoTip,
  Modal,
  QrCode,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type Toasts,
} from '@crm/ui';
import { useState } from 'react';
import { strings } from './security-strings.ts';
import { useStepUp } from './StepUp.tsx';

const copy = strings.twoFactor;

/** The secret an `otpauth://` address carries, as people type it into an app that can't scan. */
export function setupKey(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/** Hands the browser a text file of the backup codes. */
function download(codes: readonly string[]) {
  const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = copy.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** The backup codes, shown once: read only, copied or downloaded, and ticked as saved before Done. */
function BackupCodes({ codes }: { readonly codes: readonly string[] }) {
  return (
    <>
      {copy.codesText}
      <Field label={copy.codesLabel} value={codes.join('\n')} isMultiline isReadOnly />
      <CopyButton value={codes.join('\n')} label={copy.copyCodes} />
      <Button icon="download" onPress={() => download(codes)}>
        {copy.download}
      </Button>
    </>
  );
}

type Dialog =
  | { readonly kind: 'none' }
  | { readonly kind: 'setup'; readonly step: 'check' | 'scan' | 'codes' }
  | { readonly kind: 'off' }
  | { readonly kind: 'codes'; readonly step: 'check' | 'codes' };

/** Props for the two factor section. */
export interface TwoFactorSectionProps {
  readonly data: DataLayer;
  readonly security: AccountSecurityState;
  readonly toasts: Toasts;
}

/** The two factor section and its three dialogs: set up, turn off, new backup codes. */
export function TwoFactorSection({ data, security, toasts }: TwoFactorSectionProps) {
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [setup, setSetup] = useState<{ readonly totpUri: string; readonly codes: readonly string[] } | undefined>();
  const [codes, setCodes] = useState<readonly string[]>([]);
  const [firstCode, setFirstCode] = useState('');
  const [saved, setSaved] = useState(false);
  const plain = useStepUp(data, security);
  const strict = useStepUp(data, security, { secondFactor: true });

  const open = (next: Dialog) => {
    setDialog(next);
    setError(undefined);
    setFirstCode('');
    setSaved(false);
    plain.reset();
    strict.reset();
    setIsOpen(true);
  };
  const close = () => {
    if (!isBusy) setIsOpen(false);
  };
  const failed = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : copy.failedTitle);
  };

  /** Set up: the step up, then the app's address and codes from the server. */
  const startSetup = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!(await plain.prove())) return;
      const answer = await data.account.twoFactor.start();
      setSetup({ totpUri: answer.totpUri, codes: answer.backupCodes });
      setDialog({ kind: 'setup', step: 'scan' });
    } catch (failure) {
      failed(failure);
    } finally {
      setBusy(false);
    }
  };

  /** Set up: the app's first code turns it on; then the codes are shown. */
  const confirm = async (code: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await data.account.twoFactor.confirm(code);
      setDialog({ kind: 'setup', step: 'codes' });
      toasts.toast({ tone: 'success', message: copy.turnedOn });
    } catch (failure) {
      failed(failure);
      setFirstCode('');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!(await strict.prove())) return;
      await data.account.twoFactor.turnOff();
      setIsOpen(false);
      toasts.toast({ tone: 'success', message: copy.turnedOff });
    } catch (failure) {
      failed(failure);
    } finally {
      setBusy(false);
    }
  };

  const makeCodes = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!(await strict.prove())) return;
      setCodes(await data.account.twoFactor.newBackupCodes());
      setDialog({ kind: 'codes', step: 'codes' });
    } catch (failure) {
      failed(failure);
    } finally {
      setBusy(false);
    }
  };

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
    const on = security.twoFactor.on;
    card = (
      <Card>
        <SettingsRow title={copy.app} description={on ? copy.appOn : copy.appOff}>
          {on ? (
            <Button variant="danger" onPress={() => open({ kind: 'off' })}>
              {copy.turnOff}
            </Button>
          ) : (
            <Button variant="primary" onPress={() => open({ kind: 'setup', step: 'check' })}>
              {copy.setUp}
            </Button>
          )}
        </SettingsRow>
        {on && (
          <SettingsRow title={copy.backupCodes} description={copy.codesLeft(security.twoFactor.backupCodesLeft ?? 0)}>
            <Button onPress={() => open({ kind: 'codes', step: 'check' })}>{copy.newCodes}</Button>
          </SettingsRow>
        )}
      </Card>
    );
  }

  const errorNote = error === undefined ? null : <Callout tone="danger">{error}</Callout>;
  let modal;
  if (dialog.kind === 'setup') {
    const step = dialog.step;
    modal = (
      <Modal
        title={step === 'codes' ? copy.codesTitle : copy.setupTitle}
        isOpen={isOpen}
        isBusy={isBusy}
        // Once the codes show, only Done (after the tick) closes it: they won't be shown again.
        isDismissable={step !== 'codes'}
        onOpenChange={(next) => {
          if (!next && step !== 'codes') close();
        }}
        actions={
          step === 'codes' ? (
            <Button variant="primary" isDisabled={!saved} onPress={() => setIsOpen(false)}>
              {copy.done}
            </Button>
          ) : (
            <>
              <Button slot="close" kbd="ESC" isDisabled={isBusy}>
                {copy.cancel}
              </Button>
              <Button
                variant="primary"
                isPending={isBusy}
                onPress={() => void (step === 'check' ? startSetup() : confirm(firstCode))}
              >
                {step === 'check' ? copy.continue : isBusy ? copy.turningOn : copy.turnOn}
              </Button>
            </>
          )
        }
      >
        {step === 'check' && (plain.fields ?? copy.scan)}
        {step === 'scan' && setup !== undefined && (
          <>
            {copy.scan}
            <QrCode value={setup.totpUri} label={copy.qrLabel} />
            {copy.key}
            <Code isCopyable copyLabel={copy.copyKey}>
              {setupKey(setup.totpUri)}
            </Code>
            <CodeInput
              label={copy.firstCode}
              value={firstCode}
              onChange={setFirstCode}
              onComplete={(code) => void confirm(code)}
              isDisabled={isBusy}
            />
          </>
        )}
        {step === 'codes' && setup !== undefined && (
          <>
            <BackupCodes codes={setup.codes} />
            <Checkbox label={copy.saved} isSelected={saved} onChange={setSaved} />
          </>
        )}
        {errorNote}
      </Modal>
    );
  } else if (dialog.kind === 'off') {
    modal = (
      <Modal
        title={copy.turnOffTitle}
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
            <Button variant="danger-solid" isPending={isBusy} onPress={() => void turnOff()}>
              {isBusy ? copy.turningOff : copy.turnOff}
            </Button>
          </>
        }
      >
        {copy.turnOffText}
        {strict.fields}
        {errorNote}
      </Modal>
    );
  } else if (dialog.kind === 'codes') {
    const step = dialog.step;
    modal = (
      <Modal
        title={step === 'codes' ? copy.codesTitle : copy.newCodesTitle}
        isOpen={isOpen}
        isBusy={isBusy}
        isDismissable={step !== 'codes'}
        onOpenChange={(next) => {
          if (!next && step !== 'codes') close();
        }}
        actions={
          step === 'codes' ? (
            <Button variant="primary" isDisabled={!saved} onPress={() => setIsOpen(false)}>
              {copy.done}
            </Button>
          ) : (
            <>
              <Button slot="close" kbd="ESC" isDisabled={isBusy}>
                {copy.cancel}
              </Button>
              <Button variant="primary" isPending={isBusy} onPress={() => void makeCodes()}>
                {isBusy ? copy.making : copy.newCodes}
              </Button>
            </>
          )
        }
      >
        {step === 'check' && (
          <>
            {copy.newCodesText}
            {strict.fields}
          </>
        )}
        {step === 'codes' && (
          <>
            <BackupCodes codes={codes} />
            <Checkbox label={copy.saved} isSelected={saved} onChange={setSaved} />
          </>
        )}
        {errorNote}
      </Modal>
    );
  }

  return (
    <SettingsSection title={copy.section} description={<InfoTip label={copy.section}>{copy.info}</InfoTip>}>
      {card}
      {modal}
    </SettingsSection>
  );
}
