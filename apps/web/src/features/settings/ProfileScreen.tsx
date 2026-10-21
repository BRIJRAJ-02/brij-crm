// Brief
// Purpose: Settings › Account › Profile (spec 0031, AC-821): how this member appears in this workspace.
// Main task: change their name (Save shows once it changed); their time zone and dates live in Preferences.
// Leaves out: the picture upload (#32: Google's picture or initials until then), the email (the account's), and account deletion (the account lane).
import { isDataError, type DataLayer, type MyProfile } from '@crm/data';
import { Avatar, Button, ButtonLink, Card, Field, SettingsRow, SettingsSection, Skeleton, type Toasts } from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { useState } from 'react';
import { preferencesHref } from './nav.ts';
import { SettingsPage } from './SettingsPage.tsx';
import { strings } from './workspace-strings.ts';

/** Props for the Profile page. */
export interface ProfileScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly profile: MyProfile;
  /** A change landed: the route reads the profile again. */
  readonly onChanged: () => Promise<void>;
}

/**
 * One Card: picture, name, email, and the way to their time zone, which lives in Settings › Account › Preferences
 * (the owner: one home for time zone and dates); Save in the bar only while the name differs.
 */
export function ProfileScreen({ data, toasts, slug, profile, onChanged }: ProfileScreenProps) {
  const [name, setName] = useState(profile.name);
  const [isSaving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const isDirty = name.trim() !== profile.name;
  // An unsaved name isn't lost by leaving the page without a word.
  useBlocker({
    shouldBlockFn: () => isDirty && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => isDirty,
  });

  const save = () => {
    if (!isDirty || isSaving) return;
    if (name.trim() === '') {
      setNameError(strings.yourNameMissing);
      return;
    }
    setSaving(true);
    setNameError(undefined);
    data.profile
      .update(slug, { name: name.trim() })
      .then(async () => {
        await onChanged();
        toasts.toast({ tone: 'success', message: strings.saved });
      })
      .catch((error: unknown) => {
        setNameError(isDataError(error) ? error.message : strings.somethingWrong);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <SettingsPage
      title={strings.profileTitle}
      actions={
        isDirty ? (
          <Button variant="primary" isPending={isSaving} onPress={save}>
            {strings.save}
          </Button>
        ) : undefined
      }
    >
      <SettingsSection title={strings.profileSection}>
        <Card>
          <SettingsRow title={strings.picture} description={strings.pictureText}>
            <Avatar
              name={profile.name}
              id={profile.memberId}
              size="lg"
              isDecorative
              {...(profile.image === undefined ? {} : { src: profile.image })}
            />
          </SettingsRow>
          <SettingsRow title={strings.yourName}>
            <Field
              label={strings.yourName}
              isLabelHidden
              value={name}
              onChange={(next) => {
                setName(next);
                setNameError(undefined);
              }}
              onSubmit={save}
              onEscape={() => setName(profile.name)}
              maxLength={80}
              autoComplete="name"
              {...(nameError === undefined ? {} : { error: nameError })}
            />
          </SettingsRow>
          <SettingsRow title={strings.email}>
            <Field
              label={strings.email}
              isLabelHidden
              value={profile.email}
              isReadOnly
              readOnlyReason={strings.emailReadOnly}
              type="email"
            />
          </SettingsRow>
          <SettingsRow title={strings.yourZone} description={strings.zoneInPreferences}>
            <ButtonLink href={preferencesHref(slug)}>{strings.openPreferences}</ButtonLink>
          </SettingsRow>
        </Card>
      </SettingsSection>
    </SettingsPage>
  );
}

/** The page while its route loads: its rows as they will stand, the picture and each control's box a Skeleton. */
export function ProfilePending() {
  return (
    <SettingsPage title={strings.profileTitle} isLoading>
      <SettingsSection title={strings.profileSection}>
        <Card isBusy>
          <SettingsRow title={strings.picture} description={strings.pictureText}>
            <Skeleton shape="circle" />
          </SettingsRow>
          <SettingsRow title={strings.yourName}>
            <Skeleton shape="field" />
          </SettingsRow>
          <SettingsRow title={strings.email}>
            <Skeleton shape="field" />
          </SettingsRow>
          <SettingsRow title={strings.yourZone}>
            <Skeleton shape="field" />
          </SettingsRow>
        </Card>
      </SettingsSection>
    </SettingsPage>
  );
}
