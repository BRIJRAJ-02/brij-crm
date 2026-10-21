// Brief
// Purpose: Settings › Account › Profile (spec 0031, AC-821): how this member appears in this workspace.
// Main task: change their name (Save shows once it changed) or their time zone (saved at once, with Undo).
// Leaves out: the picture upload (#32: Google's picture or initials until then), the email (the account's), and account deletion (the account lane).
import { isDataError, type DataLayer, type MyProfile } from '@crm/data';
import { Avatar, Button, Card, EmptyState, Field, Select, SettingsRow, SettingsSection, type Toasts } from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { zoneItems, zoneLabel, zoneMatches } from '../booking/hours.ts';
import { SettingsPage } from './SettingsPage.tsx';
import { strings } from './workspace-strings.ts';

/** The time zone choice that follows the workspace's: no zone of their own. */
const FOLLOWS = 'workspace';

/** Props for the Profile page. */
export interface ProfileScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly profile: MyProfile;
  /** A change landed: the route reads the profile again. */
  readonly onChanged: () => Promise<void>;
}

/** One Card: picture, name, email and time zone; Save in the bar only while the name differs. */
export function ProfileScreen({ data, toasts, slug, profile, onChanged }: ProfileScreenProps) {
  const [name, setName] = useState(profile.name);
  const [isSaving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [zoneBusy, setZoneBusy] = useState(false);
  const current = profile.timeZone ?? FOLLOWS;
  const zones = useMemo(
    () => [
      { id: FOLLOWS, label: strings.sameAsWorkspace(zoneLabel(profile.workspaceTimeZone)) },
      ...zoneItems(profile.timeZone ?? profile.workspaceTimeZone, new Date()),
    ],
    [profile.timeZone, profile.workspaceTimeZone],
  );
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

  const setZone = (zone: string, previous: string, withUndo: boolean) => {
    setZoneBusy(true);
    data.profile
      .update(slug, { timeZone: zone === FOLLOWS ? null : zone })
      .then(async () => {
        await onChanged();
        toasts.toast({
          tone: 'success',
          message: zone === FOLLOWS ? strings.zoneFollows : strings.zoneChanged(zoneLabel(zone)),
          ...(withUndo ? { action: { label: strings.undo, onAction: () => setZone(previous, zone, false) } } : {}),
        });
      })
      .catch((error: unknown) => {
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
      })
      .finally(() => {
        setZoneBusy(false);
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
          <SettingsRow title={strings.yourZone}>
            <Select
              label={strings.yourZone}
              isLabelHidden
              showsDescription
              items={zones}
              filter={zoneMatches}
              isSearchable
              value={current}
              isDisabled={zoneBusy}
              onChange={(zone) => {
                if (zone !== null && zone !== current) setZone(zone, current, true);
              }}
            />
          </SettingsRow>
        </Card>
      </SettingsSection>
    </SettingsPage>
  );
}

/** The page while its route loads. */
export function ProfilePending() {
  return (
    <SettingsPage title={strings.profileTitle} isLoading>
      <EmptyState title={strings.profileTitle} isLoading />
    </SettingsPage>
  );
}
