// Brief
// Purpose: Settings › Account › Profile (spec 0031, AC-821): how this member appears in this workspace.
// Main task: change their name (the SaveBar at the view's foot shows once it changed).
// Leaves out: the picture upload (#32: Google's picture or initials until then, so no button), editing the email (the account's), the time zone (Preferences, right above in the nav), and account deletion (the account lane).
import { isDataError, type DataLayer, type MyProfile } from '@crm/data';
import { useAccountSecurity } from '@crm/data/react';
import {
  Avatar,
  Button,
  Card,
  Field,
  SaveBar,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type SaveBarStatus,
} from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { useState } from 'react';
import { pageHeading } from '../navigation/focus.ts';
import { DeleteAccountSection } from './DeleteAccountSection.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { strings as securityCopy } from './security-strings.ts';
import { strings } from './workspace-strings.ts';

/** Props for the Profile page. */
export interface ProfileScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly profile: MyProfile;
  /** A change landed: the route reads the profile again. */
  readonly onChanged: () => Promise<void>;
}

/**
 * One Card: their picture with their name beside it, the name to change, and the sign in email as plain text.
 * The SaveBar at the view's foot only while the name differs: Discard puts the saved name back.
 */
export function ProfileScreen({ data, slug, profile, onChanged }: ProfileScreenProps) {
  // Deleting the account asks for a step up, which reads how this account signs in.
  const security = useAccountSecurity(data.account.security());
  const [name, setName] = useState(profile.name);
  const [isSaving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Why the last save failed, said in the bar.
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const isDirty = name.trim() !== profile.name;
  const isNameMissing = name.trim() === '';
  // An unsaved name isn't lost by leaving the page without a word.
  useBlocker({
    shouldBlockFn: () => isDirty && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => isDirty,
  });

  const save = () => {
    if (!isDirty || isSaving || isNameMissing) return;
    setSaving(true);
    setFailure(undefined);
    data.profile
      .update(slug, { name: name.trim() })
      .then(async () => {
        await onChanged();
        setJustSaved(true);
      })
      .catch((error: unknown) => {
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const status: SaveBarStatus = isSaving
    ? 'saving'
    : isDirty
      ? failure === undefined
        ? 'unsaved'
        : 'error'
      : justSaved
        ? 'saved'
        : 'hidden';

  return (
    <SettingsPage
      title={strings.profileTitle}
      footer={
        <SaveBar
          status={status}
          {...(failure === undefined ? {} : { error: failure })}
          {...(isNameMissing && isDirty ? { blockedReason: strings.yourNameMissing } : {})}
          onSave={save}
          onDiscard={() => {
            setName(profile.name);
            setFailure(undefined);
          }}
          onFocusAway={() => pageHeading(document)?.focus()}
        />
      }
    >
      {/* A section like the danger zone under it, so the two read as parts of one page with a line between. */}
      <SettingsSection title={strings.detailsSection}>
        <Card>
          <SettingsRow
            title={profile.name}
            leadingAlign="center"
            leading={
              <Avatar
                name={profile.name}
                id={profile.memberId}
                size="xl"
                isDecorative
                {...(profile.image === undefined ? {} : { src: profile.image })}
              />
            }
            {...(profile.image === undefined ? {} : { description: strings.fromGoogle })}
          />
          <SettingsRow title={strings.yourName} control="field">
            <Field
              label={strings.yourName}
              isLabelHidden
              value={name}
              onChange={(next) => {
                setName(next);
                setFailure(undefined);
                setJustSaved(false);
              }}
              onSubmit={save}
              onEscape={() => setName(profile.name)}
              maxLength={80}
              autoComplete="name"
              {...(isNameMissing && isDirty ? { error: strings.yourNameMissing } : {})}
            />
          </SettingsRow>
          <SettingsRow title={strings.email} description={strings.emailUse} control="field">
            {profile.email}
          </SettingsRow>
        </Card>
      </SettingsSection>
      {/* Last on the person's own page, set apart under its own heading (the owner, 22 October 2026). */}
      <DeleteAccountSection data={data} security={security} />
    </SettingsPage>
  );
}

/** The page while its route loads: its rows as they will stand, the picture and the name's box a Skeleton. */
export function ProfilePending() {
  return (
    <SettingsPage title={strings.profileTitle} isLoading>
      <SettingsSection title={strings.detailsSection}>
        <Card isBusy>
          <SettingsRow
            title=""
            description={<Skeleton width="short" />}
            leadingAlign="center"
            leading={<Skeleton shape="circle" />}
          />
          <SettingsRow title={strings.yourName} control="field">
            <Skeleton shape="field" />
          </SettingsRow>
          <SettingsRow title={strings.email} description={strings.emailUse} control="field">
            <Skeleton />
          </SettingsRow>
        </Card>
      </SettingsSection>
      <SettingsSection title={securityCopy.deletion.section}>
        <Card>
          <SettingsRow title={securityCopy.deletion.row} description={securityCopy.deletion.rowText}>
            <Button variant="danger" isDisabled>
              {securityCopy.deletion.action}
            </Button>
          </SettingsRow>
        </Card>
      </SettingsSection>
    </SettingsPage>
  );
}
