// Brief
// Purpose: Settings › Account › Profile (spec 0031, AC-821): how this member appears in this workspace.
// Main task: change their name (Save shows once it changed).
// Leaves out: the picture upload (#32: Google's picture or initials until then, so no button), editing the email (the account's), the time zone (Preferences, right above in the nav), and account deletion (the account lane).
import { isDataError, type DataLayer, type MyProfile } from '@crm/data';
import { Avatar, Button, Card, Field, SettingsRow, Skeleton, type Toasts } from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { useState } from 'react';
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
 * One Card: their picture with their name beside it, the name to change, and the sign in email as plain text.
 * Save in the bar only while the name differs.
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
              setNameError(undefined);
            }}
            onSubmit={save}
            onEscape={() => setName(profile.name)}
            maxLength={80}
            autoComplete="name"
            {...(nameError === undefined ? {} : { error: nameError })}
          />
        </SettingsRow>
        <SettingsRow title={strings.email} description={strings.emailUse} control="field">
          {profile.email}
        </SettingsRow>
      </Card>
    </SettingsPage>
  );
}

/** The page while its route loads: its rows as they will stand, the picture and the name's box a Skeleton. */
export function ProfilePending() {
  return (
    <SettingsPage title={strings.profileTitle} isLoading>
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
    </SettingsPage>
  );
}
