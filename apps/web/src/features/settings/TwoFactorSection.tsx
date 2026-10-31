// Brief
// Purpose: Account › Sign in and devices' two factor sign in (spec 0033, AC-881, AC-883, AC-885): on or off, and backup codes.
// Main task: set the authenticator app up (QR code with its three steps beside it, the first code under step 3, the
// setup key under the code, then the backup codes saved), turn it off, or make new codes.
// Leaves out: the workspace's requirement (milestone 4).
import type { AccountSecurityState, DataLayer } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Code,
  CodeInput,
  EmptyState,
  FieldGroup,
  InfoTip,
  Modal,
  QrCode,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type Toasts,
} from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { strings } from './security-strings.ts';
import { useStepUp } from './StepUp.tsx';

const copy = strings.twoFactor;

/** The secret an `otpauth://` address carries, in groups of 4, as people type it into an app that can't scan. */
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
  // Some browsers cancel a download whose address goes at once.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * The backup codes, shown once in the code face (0 and O, I and l apart), two columns of whole codes, copied (one per
 * line) or downloaded.
 */
function BackupCodes({ codes }: { readonly codes: readonly string[] }) {
  return (
    <>
      {copy.codesText}
      <Code variant="list" isCopyable copyLabel={copy.copyCodes}>
        {codes.join('\n')}
      </Code>
      <Button
        icon="download"
        // Focus starts here, not on the title bar's Close, where an Enter would end the only showing (Q103).
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        onPress={() => download(codes)}
      >
        {copy.download}
      </Button>
    </>
  );
}

type Dialog =
  | { readonly kind: 'setup'; readonly step: 'check' | 'scan' | 'codes' }
  | { readonly kind: 'off' }
  | { readonly kind: 'codes'; readonly step: 'check' | 'codes' };

/** Props for the two factor section. */
export interface TwoFactorSectionProps {
  readonly data: DataLayer;
  readonly security: AccountSecurityState;
  readonly toasts: Toasts;
  /** Where focus goes when the button that opened a dialog went with its change (Set up and Turn off swap). */
  readonly onFocusLost: () => void;
  /** After a change lands (turned on or off, new backup codes): Recent activity reads its first page again. */
  readonly onChanged?: () => void;
}

/** The two factor section and its three dialogs: set up, turn off, new backup codes. */
export function TwoFactorSection({
  data,
  security,
  toasts,
  onFocusLost,
  onChanged = () => undefined,
}: TwoFactorSectionProps) {
  const [dialog, setDialog] = useState<Dialog>({ kind: 'off' });
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [setup, setSetup] = useState<{ readonly totpUri: string; readonly codes: readonly string[] } | undefined>();
  const [codes, setCodes] = useState<readonly string[]>([]);
  const [firstCode, setFirstCode] = useState('');
  const [saved, setSaved] = useState(false);
  const firstCodeField = useRef<HTMLInputElement>(null);
  const [focusFirstCode, setFocusFirstCode] = useState(0);
  useEffect(() => {
    if (focusFirstCode > 0) firstCodeField.current?.focus();
  }, [focusFirstCode]);

  const failed = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : copy.failedTitle);
  };

  const plainProve = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const strictProve = useRef<() => Promise<boolean>>(() => Promise.resolve(true));

  /** Set up: the step up when needed, then the app's address and codes from the server. */
  const startSetup = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!(await plainProve.current())) return;
      const answer = await data.account.twoFactor.start();
      setSetup({ totpUri: answer.totpUri, codes: answer.backupCodes });
      setDialog({ kind: 'setup', step: 'scan' });
      setFocusFirstCode((count) => count + 1);
    } catch (failure) {
      failed(failure);
    } finally {
      setBusy(false);
    }
  };

  /** Set up: the app's first code turns it on; then the codes are shown. */
  const confirm = async (code: string) => {
    if (code.length !== 6) {
      setError(copy.firstCodeMissing);
      setFocusFirstCode((count) => count + 1);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await data.account.twoFactor.confirm(code);
      setDialog({ kind: 'setup', step: 'codes' });
      toasts.toast({ tone: 'success', message: copy.turnedOn });
      onChanged();
    } catch (failure) {
      failed(failure);
      setFirstCode('');
      setFocusFirstCode((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!(await strictProve.current())) return;
      await data.account.twoFactor.turnOff();
      setIsOpen(false);
      onFocusLost();
      toasts.toast({ tone: 'success', message: copy.turnedOff });
      onChanged();
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
      if (!(await strictProve.current())) return;
      setCodes(await data.account.twoFactor.newBackupCodes());
      setDialog({ kind: 'codes', step: 'codes' });
      onChanged();
    } catch (failure) {
      failed(failure);
    } finally {
      setBusy(false);
    }
  };

  const plain = useStepUp(data, security, { onComplete: () => void startSetup() });
  const strict = useStepUp(data, security, {
    secondFactor: true,
    onComplete: () => void (dialog.kind === 'off' ? turnOff() : makeCodes()),
  });
  // The handlers above run after render, so they read the latest checks.
  useEffect(() => {
    plainProve.current = plain.prove;
    strictProve.current = strict.prove;
  });

  const open = (next: Dialog) => {
    setDialog(next);
    setError(undefined);
    setFirstCode('');
    setSaved(false);
    plain.reset();
    strict.reset();
    setIsOpen(true);
    // Turning off and new codes open on the app's code, so the code typed at once lands in its boxes (Q86).
    if (next.kind !== 'setup') strict.focus();
    // Nothing to check first: straight to the QR code.
    if (next.kind === 'setup' && !plain.isNeeded) void startSetup();
  };
  const close = () => {
    if (isBusy) return;
    setIsOpen(false);
    // Closing on the codes step after setup: Set up became Turn off.
    if (dialog.kind === 'setup' && dialog.step === 'codes') onFocusLost();
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
    // A workspace that requires two factor keeps the app on (AC-885); the server says so too.
    const kept = on && security.requiredBy.length > 0;
    card = (
      <Card>
        <SettingsRow
          title={copy.app}
          // The section's why, on its first row: SettingsSection has no slot beside its heading.
          meta={<InfoTip label={copy.app}>{copy.appInfo}</InfoTip>}
          description={kept ? copy.appRequired(security.requiredBy) : on ? copy.appOn : copy.appOff}
        >
          {on ? (
            // Quiet in the row, as a device's Sign out is: the danger confirm carries the weight.
            <Button variant="secondary" isDisabled={kept} onPress={() => open({ kind: 'off' })}>
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

  // A refusal shows first in the body, as a danger Callout (Modal's rule); a wrong first code shows on its boxes.
  const errorNote =
    error === undefined || (dialog.kind === 'setup' && dialog.step === 'scan') ? null : (
      <Callout tone="danger">{error}</Callout>
    );
  const savedTick = <Checkbox label={copy.saved} isSelected={saved} onChange={setSaved} />;
  const done = (
    <Button variant="primary" isDisabled={!saved} onPress={close}>
      {copy.done}
    </Button>
  );
  let modal;
  if (dialog.kind === 'setup') {
    const step = dialog.step;
    modal = (
      <Modal
        title={step === 'codes' ? copy.codesTitle : copy.setupTitle}
        isOpen={isOpen}
        isBusy={isBusy}
        // The codes won't be shown again: a click outside never closes them, and until "I've saved these" is ticked
        // there is no close button and Esc does nothing (Q103). Make new codes is the way back if they were lost.
        isDismissable={step !== 'codes'}
        isClosable={step !== 'codes' || saved}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        actions={
          step === 'codes' ? (
            done
          ) : (
            <>
              <Button slot="close" isDisabled={isBusy}>
                {copy.cancel}
              </Button>
              <Button
                variant="primary"
                isPending={isBusy}
                onPress={() => void (step === 'check' ? startSetup() : confirm(firstCode))}
              >
                {step === 'check'
                  ? // The press that only emails a code says so; once the code's field shows, it goes on.
                    plain.willSend
                    ? strings.stepUp.send
                    : copy.continue
                  : isBusy
                    ? copy.turningOn
                    : copy.turnOn}
              </Button>
            </>
          )
        }
      >
        {errorNote}
        {step === 'check' && plain.fields}
        {step === 'scan' && setup !== undefined && (
          <>
            {/* The steps and the setup key beside the code (under it on a phone); the code's boxes under all of it,
                at the dialog's full width, so each box is large enough to read and press. */}
            <QrCode value={setup.totpUri} label={copy.qrLabel}>
              <p>{copy.steps[0]}</p>
              <p>{copy.steps[1]}</p>
              <FieldGroup label={copy.key}>
                <Code variant="block" isCopyable copyLabel={copy.copyKey}>
                  {setupKey(setup.totpUri)}
                </Code>
              </FieldGroup>
              <p>{copy.steps[2]}</p>
            </QrCode>
            <CodeInput
              ref={firstCodeField}
              label={copy.firstCode}
              // Step 3 says what the boxes are for; screen readers still hear the label.
              isLabelHidden
              size="lg"
              value={firstCode}
              onChange={setFirstCode}
              onComplete={(code) => void confirm(code)}
              {...(error === undefined ? {} : { error })}
            />
          </>
        )}
        {step === 'codes' && setup !== undefined && (
          <>
            <BackupCodes codes={setup.codes} />
            {savedTick}
          </>
        )}
      </Modal>
    );
  } else if (dialog.kind === 'off') {
    modal = (
      <Modal
        title={copy.turnOffTitle}
        variant="confirm"
        tone="danger"
        isOpen={isOpen}
        isBusy={isBusy}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isBusy}>
              {copy.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isBusy} onPress={() => void turnOff()}>
              {isBusy ? copy.turningOff : copy.turnOff}
            </Button>
          </>
        }
      >
        {errorNote}
        {copy.turnOffText}
        {strict.fields}
      </Modal>
    );
  } else {
    const step = dialog.step;
    modal = (
      <Modal
        title={step === 'codes' ? copy.codesTitle : copy.newCodesTitle}
        isOpen={isOpen}
        isBusy={isBusy}
        // As setup's codes: kept until "I've saved these" is ticked (Q103).
        isDismissable={step !== 'codes'}
        isClosable={step !== 'codes' || saved}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        actions={
          step === 'codes' ? (
            done
          ) : (
            <>
              <Button slot="close" isDisabled={isBusy}>
                {copy.cancel}
              </Button>
              <Button variant="primary" isPending={isBusy} onPress={() => void makeCodes()}>
                {isBusy ? copy.making : copy.newCodes}
              </Button>
            </>
          )
        }
      >
        {errorNote}
        {step === 'check' && (
          <>
            {copy.newCodesText}
            {strict.fields}
          </>
        )}
        {step === 'codes' && (
          <>
            <BackupCodes codes={codes} />
            {savedTick}
          </>
        )}
      </Modal>
    );
  }

  return (
    <SettingsSection title={copy.section}>
      {card}
      {modal}
    </SettingsSection>
  );
}
