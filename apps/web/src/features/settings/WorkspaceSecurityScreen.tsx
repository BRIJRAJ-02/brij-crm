// Brief
// Purpose: Settings › Workspace › Security (spec 0033, milestone 4): how people sign in to this workspace, owners only.
// Main task: require two factor sign in for everyone, set how long a sign in lasts here, or sign everyone out.
// Leaves out: sign in methods and SSO (later), and each person's own devices (Account › Sign in and devices has those).
import {
  isDataError,
  SESSION_LENGTH_DAYS,
  type DataLayer,
  type SessionLengthDays,
  type WorkspaceSecurity,
} from '@crm/data';
import { useAccountSecurity } from '@crm/data/react';
import {
  Button,
  Callout,
  Card,
  InfoTip,
  Link,
  Modal,
  Select,
  SettingsRow,
  SettingsSection,
  Skeleton,
  Switch,
  type Toasts,
} from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { securitySettingsHref } from './nav.ts';
import { SettingsPage } from './SettingsPage.tsx';
import { useStepUp } from './StepUp.tsx';
import { strings } from './workspace-security-strings.ts';

/** The session length Select's items: no limit, then each length the workspace may ask for. */
const LENGTHS = [
  { id: 'none', label: strings.noLimit },
  ...SESSION_LENGTH_DAYS.map((count) => ({ id: String(count), label: strings.days(count) })),
] as const;

/** The Select's id for a length, and back. */
const lengthId = (days: SessionLengthDays | undefined): string => (days === undefined ? 'none' : String(days));
const lengthOf = (id: string | null): SessionLengthDays | null => {
  const found = SESSION_LENGTH_DAYS.find((count) => String(count) === id);
  return found ?? null;
};

/** A day, as the Sign out everyone row says when it was last done. */
const dayOf = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** Which confirm is showing: requiring two factor (when someone isn't set up), a shorter session, or signing everyone out. */
type Confirm = 'require' | 'signOut' | 'length';

/** Props for the Workspace › Security screen. */
export interface WorkspaceSecurityScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly workspaceName: string;
  /** The rules as the route's loader read them; each answer from the server replaces them. */
  readonly initial: WorkspaceSecurity;
}

/** Settings › Workspace › Security: Two factor sign in, then Sessions; each change waits for the server's answer. */
export function WorkspaceSecurityScreen({ data, toasts, slug, workspaceName, initial }: WorkspaceSecurityScreenProps) {
  const [rules, setRules] = useState(initial);
  const [saving, setSaving] = useState<'require' | 'length' | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirm, setConfirm] = useState<Confirm>('require');
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Signing everyone out needs a recent check (AC-896): asked inline in its confirm when this session isn't fresh.
  const security = useAccountSecurity(data.account.security());
  const commit = useRef<() => void>(() => undefined);
  const stepUp = useStepUp(data, security, { onComplete: () => commit.current() });

  const refusal = (failure: unknown) =>
    isDataError(failure) && failure.code !== 'INTERNAL' ? failure.message : strings.saveFailed;

  const save = async (
    what: 'require' | 'length',
    change: { readonly requireTwoFactor?: boolean; readonly sessionLengthDays?: SessionLengthDays | null },
    done: string,
  ): Promise<boolean> => {
    setSaving(what);
    setError(undefined);
    try {
      setRules(await data.workspaceSecurity.set(slug, change));
      toasts.toast({ tone: 'success', message: done });
      return true;
    } catch (failure) {
      setError(refusal(failure));
      return false;
    } finally {
      setSaving(undefined);
    }
  };

  // A shorter session length signs out whoever signed in longer ago than it: asked first, as signing out is.
  const [pendingLength, setPendingLength] = useState<SessionLengthDays>(1);
  const setLength = (next: SessionLengthDays | null) => {
    const was = rules.sessionLengthDays;
    if (next !== null && (was === undefined || next < was)) {
      setPendingLength(next);
      setConfirm('length');
      setIsOpen(true);
      return;
    }
    void save('length', { sessionLengthDays: next }, strings.lengthSaved(next ?? undefined));
  };

  const shortenNow = async () => {
    setIsBusy(true);
    await save('length', { sessionLengthDays: pendingLength }, strings.lengthSaved(pendingLength));
    setIsBusy(false);
    setIsOpen(false);
  };

  const setRequire = (next: boolean) => {
    // Turning it on locks out whoever isn't set up until they are: asked first when that's anyone.
    if (next && rules.membersWithout > 0) {
      setConfirm('require');
      setIsOpen(true);
      return;
    }
    void save('require', { requireTwoFactor: next }, next ? strings.required : strings.notRequired);
  };

  const signOutEveryone = async () => {
    setIsBusy(true);
    if (!(await stepUp.prove())) {
      setIsBusy(false);
      return;
    }
    try {
      setRules(await data.workspaceSecurity.signOutEveryone(slug));
      setIsOpen(false);
      requestAnimationFrame(() => titleRef.current?.focus());
      toasts.toast({ tone: 'success', message: strings.signedOutEveryone });
    } catch (failure) {
      if (isDataError(failure) && failure.code === 'STEP_UP_REQUIRED') {
        // The check ran out meanwhile: read the state again, so the confirm asks for it inline.
        void data.account.security().reload();
      } else {
        setIsOpen(false);
        setError(refusal(failure));
      }
    } finally {
      setIsBusy(false);
    }
  };

  const requireNow = async () => {
    setIsBusy(true);
    // Refused or not, the confirm closes: a refusal shows above the sections.
    await save('require', { requireTwoFactor: true }, strings.required);
    setIsBusy(false);
    setIsOpen(false);
  };

  // A complete code in the confirm, or its button, runs what the confirm asks about.
  useEffect(() => {
    commit.current = () => {
      if (isBusy) return;
      if (confirm === 'signOut') void signOutEveryone();
      else if (confirm === 'length') void shortenNow();
      else void requireNow();
    };
  });

  const ask = (next: Confirm) => {
    setConfirm(next);
    stepUp.reset();
    setIsOpen(true);
  };

  const mayRequire = rules.requireTwoFactor || rules.youHaveTwoFactor;
  const isSignOut = confirm === 'signOut';
  return (
    <SettingsPage title={strings.title} titleRef={titleRef}>
      {error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      <SettingsSection title={strings.twoFactor}>
        <Card isBusy={saving === 'require'}>
          <SettingsRow
            title={strings.require}
            meta={<InfoTip label={strings.require}>{strings.requireInfo}</InfoTip>}
            description={
              rules.requireTwoFactor ? (
                strings.requireOn(rules.membersWithout)
              ) : mayRequire ? (
                strings.requireOff
              ) : (
                // Off limits until the owner has it: the row says why, with the way to set it up, and no box above.
                <>
                  {strings.youFirst} <Link href={securitySettingsHref(slug)}>{strings.setUpYours}</Link>
                </>
              )
            }
          >
            <Switch
              label={strings.require}
              isLabelHidden
              isSelected={rules.requireTwoFactor}
              isDisabled={!mayRequire || saving === 'require'}
              onChange={setRequire}
            />
          </SettingsRow>
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.sessions}>
        <Card isBusy={saving === 'length'}>
          <SettingsRow
            title={strings.sessionLength}
            meta={<InfoTip label={strings.sessionLength}>{strings.sessionLengthInfo}</InfoTip>}
            description={strings.sessionLengthDescription}
          >
            <Select
              savesOnPick
              label={strings.sessionLength}
              isLabelHidden
              items={LENGTHS}
              value={lengthId(rules.sessionLengthDays)}
              isDisabled={saving === 'length'}
              onChange={(id) => {
                const next = lengthOf(id);
                if (lengthId(next ?? undefined) === lengthId(rules.sessionLengthDays)) return;
                setLength(next);
              }}
            />
          </SettingsRow>
          <SettingsRow
            title={strings.signOutEveryone}
            description={
              rules.signedOutEveryoneAt === undefined
                ? strings.signOutEveryoneDescription
                : `${strings.signOutEveryoneDescription} ${strings.lastSignedOut(dayOf(rules.signedOutEveryoneAt))}`
            }
          >
            <Button variant="danger" onPress={() => ask('signOut')}>
              {strings.signOutEveryone}
            </Button>
          </SettingsRow>
        </Card>
      </SettingsSection>
      <Modal
        title={
          isSignOut
            ? strings.signOutEveryoneTitle
            : confirm === 'length'
              ? strings.confirmLengthTitle(pendingLength)
              : strings.confirmRequireTitle
        }
        {...(confirm === 'require' ? {} : { tone: 'danger' as const })}
        isOpen={isOpen}
        isBusy={isBusy}
        onOpenChange={(open) => {
          if (!open && !isBusy) setIsOpen(false);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC" isDisabled={isBusy}>
              {strings.cancel}
            </Button>
            <Button
              variant={confirm === 'require' ? 'primary' : 'danger-solid'}
              isPending={isBusy}
              onPress={() => commit.current()}
            >
              {isSignOut
                ? isBusy
                  ? strings.signingOut
                  : stepUp.willSend
                    ? strings.sendCode
                    : strings.signOutEveryone
                : confirm === 'length'
                  ? strings.shortenAction
                  : strings.requireAction}
            </Button>
          </>
        }
      >
        {isSignOut
          ? strings.signOutEveryoneText(workspaceName)
          : confirm === 'length'
            ? strings.confirmLengthText(pendingLength, workspaceName)
            : strings.confirmRequireText(rules.membersWithout, workspaceName)}
        {isSignOut && stepUp.fields}
      </Modal>
    </SettingsPage>
  );
}

/** Settings › Workspace › Security while it loads: its sections and rows in place, each control a skeleton. */
export function WorkspaceSecurityPending() {
  return (
    <SettingsPage title={strings.title} isLoading>
      <SettingsSection title={strings.twoFactor}>
        <Card isBusy>
          <SettingsRow title={strings.require} meta={<InfoTip label={strings.require}>{strings.requireInfo}</InfoTip>}>
            <Skeleton shape="field" />
          </SettingsRow>
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.sessions}>
        <Card isBusy>
          <SettingsRow
            title={strings.sessionLength}
            meta={<InfoTip label={strings.sessionLength}>{strings.sessionLengthInfo}</InfoTip>}
          >
            <Skeleton shape="field" />
          </SettingsRow>
          <SettingsRow title={strings.signOutEveryone}>
            <Button variant="danger" isDisabled>
              {strings.signOutEveryone}
            </Button>
          </SettingsRow>
        </Card>
      </SettingsSection>
    </SettingsPage>
  );
}
