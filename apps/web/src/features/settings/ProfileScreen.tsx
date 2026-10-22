// Brief
// Purpose: Settings › Account › Profile (spec 0031, AC-821): how this member appears in this workspace.
// Main task: change their name (the SaveBar at the view’s foot shows once it changed), or delete the account.
// Also their public profile (22 Oct 2026): the handle their booking addresses start with (/<handle>/<slug>) and a one
// line bio, the person's own in every workspace; a new handle keeps the old one working.
// Leaves out: the picture upload (#32: Google's picture or initials until then, so no button), editing the email (the account's), the time zone (Preferences, right above in the nav). Deleting the account sits last, in its Danger zone (moved here from Account › Security, 22 October 2026).
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
import { handleProblem } from '@crm/contracts/handles';
import { useState } from 'react';
import { publicBookingOrigin, publicProfileUrl } from '../booking/links.ts';
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
  // The handle starts from the saved one, else a free one made from their name, which they claim by saving.
  const [handle, setHandle] = useState(profile.handle ?? profile.suggestedHandle ?? '');
  const [isClaiming, setClaiming] = useState(false);
  const [bio, setBio] = useState(profile.bio);
  const [isSaving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Why the last save failed, said in the bar.
  const [failure, setFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
  const wantedHandle = handle.trim().toLowerCase();
  // With no handle yet, the suggestion is only a suggestion until they edit it or press Claim.
  const isHandleDirty =
    profile.handle === undefined ? isClaiming && wantedHandle !== '' : wantedHandle !== profile.handle;
  const isBioDirty = bio.trim() !== profile.bio;
  const isNameDirty = name.trim() !== profile.name;
  const isDirty = isNameDirty || isHandleDirty || isBioDirty;
  const isNameMissing = name.trim() === '';
  const handleError = isHandleDirty ? handleProblem(wantedHandle) : undefined;
  const isBioWithoutHandle = isBioDirty && profile.handle === undefined && !isHandleDirty;
  const blockedReason = isNameMissing
    ? strings.yourNameMissing
    : handleError !== undefined
      ? strings.handleFix
      : isBioWithoutHandle
        ? strings.bioNeedsHandle
        : undefined;
  // An unsaved name isn't lost by leaving the page without a word.
  useBlocker({
    shouldBlockFn: () => isDirty && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => isDirty,
  });

  const send = (change: { readonly name?: string; readonly handle?: string; readonly bio?: string }) => {
    setSaving(true);
    setFailure(undefined);
    data.profile
      .update(slug, change)
      .then(async () => {
        await onChanged();
        setClaiming(false);
        setJustSaved(true);
      })
      .catch((error: unknown) => {
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        setFailure({
          message: isDataError(error) ? error.message : strings.somethingWrong,
          ...(field === undefined ? {} : { field }),
        });
      })
      .finally(() => {
        setSaving(false);
      });
  };
  const save = () => {
    if (!isDirty || isSaving || blockedReason !== undefined) return;
    send({
      ...(isNameDirty ? { name: name.trim() } : {}),
      ...(isHandleDirty ? { handle: wantedHandle } : {}),
      ...(isBioDirty ? { bio: bio.trim() } : {}),
    });
  };
  // Claim takes the suggested handle at once, on its own.
  const claim = () => {
    if (isSaving || handleProblem(wantedHandle) !== undefined) return;
    setClaiming(true);
    send({ handle: wantedHandle });
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
          {...(failure === undefined ? {} : { error: failure.message })}
          {...(blockedReason !== undefined && isDirty ? { blockedReason } : {})}
          onSave={save}
          onDiscard={() => {
            setName(profile.name);
            setHandle(profile.handle ?? profile.suggestedHandle ?? '');
            setClaiming(false);
            setBio(profile.bio);
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
      {/* The public profile (22 Oct 2026): the person's own, the same in every workspace. */}
      <SettingsSection title={strings.publicProfileSection} description={strings.publicProfileText}>
        <Card>
          <SettingsRow
            title={strings.handle}
            description={profile.handle === undefined ? strings.handleNew : strings.handleKept}
            control="field"
          >
            <Field
              label={strings.handle}
              isLabelHidden
              value={handle}
              prefix={`${new URL(publicBookingOrigin()).host}/`}
              maxLength={40}
              autoComplete="off"
              onChange={(next) => {
                setHandle(next.toLowerCase());
                setClaiming(true);
                setFailure(undefined);
                setJustSaved(false);
              }}
              onSubmit={save}
              {...(profile.handle === undefined && !isHandleDirty && wantedHandle !== ''
                ? {
                    after: (
                      <Button variant="secondary" isDisabled={isSaving} onPress={claim}>
                        {strings.claimHandle}
                      </Button>
                    ),
                  }
                : {})}
              {...(handleError !== undefined
                ? { error: handleError }
                : failure?.field === 'handle'
                  ? { error: failure.message }
                  : {})}
            />
          </SettingsRow>
          <SettingsRow title={strings.bio} description={strings.bioText} control="field">
            <Field
              label={strings.bio}
              isLabelHidden
              value={bio}
              maxLength={160}
              showCounter
              onChange={(next) => {
                setBio(next.replace(/[\r\n]+/g, ' '));
                setFailure(undefined);
                setJustSaved(false);
              }}
              onSubmit={save}
              {...(failure?.field === 'bio' ? { error: failure.message } : {})}
            />
          </SettingsRow>
          {profile.handle !== undefined && (
            <SettingsRow title={strings.yourPage} control="field">
              <Field
                label={strings.yourPage}
                isLabelHidden
                variant="copy"
                copyLabel={strings.copyLink}
                value={publicProfileUrl(profile.handle)}
              />
            </SettingsRow>
          )}
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
      <SettingsSection title={strings.publicProfileSection} description={strings.publicProfileText}>
        <Card isBusy>
          <SettingsRow title={strings.handle} control="field">
            <Skeleton shape="field" />
          </SettingsRow>
          <SettingsRow title={strings.bio} control="field">
            <Skeleton shape="field" />
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
