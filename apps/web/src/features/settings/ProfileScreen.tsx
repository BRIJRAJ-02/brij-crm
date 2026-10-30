// Brief
// Purpose: Settings › Account › Profile (spec 0031, AC-821): how this member appears in this workspace.
// Main task: change their name (the SaveBar at the view’s foot shows once it changed), or delete the account.
// Also their public profile (22 Oct 2026): the handle their booking addresses start with (/<handle>/<slug>) and a one
// line bio, the person's own in every workspace; a new handle keeps the old one working. And Sync Google photo beside
// the picture where Google sign in is on (23 Oct 2026): their Google account's current photo, linking Google first. Under it, a row
// that opens their link page's editor (spec 0051, Settings › Account › Link page).
// Leaves out: the picture upload (#32: Google's picture or initials until then), editing the email (the account's), the time zone (Preferences, right above in the nav). Deleting the account sits last, in its Danger zone (moved here from Account › Security, 22 October 2026).
import { isDataError, type DataLayer, type MyProfile } from '@crm/data';
import { useAccountSecurity } from '@crm/data/react';
import {
  Avatar,
  Button,
  ButtonLink,
  Callout,
  Card,
  Field,
  SaveBar,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type SaveBarStatus,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { handleProblem } from '@crm/contracts/handles';
import { useCallback, useEffect, useRef, useState } from 'react';
import { publicBookingOrigin, publicProfileUrl } from '../booking/links.ts';
import { pageHeading } from '../navigation/focus.ts';
import { LeaveGuard } from '../navigation/LeaveGuard.tsx';
import { DeleteAccountSection } from './DeleteAccountSection.tsx';
import { PhotoSwitch, PhotoSwitchPending } from './PhotoSwitch.tsx';
import { strings as linkPageCopy } from '../link-page/strings.ts';
import { linkPageHref } from '../link-page/nav-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';
import {
  SocialLinksSectionPending,
  SocialLinksSectionSlot,
  type SocialsDraftControl,
  type SocialsDraftState,
} from './socials-slot.tsx';
import { strings as socialsCopy } from './socials-strings.ts';
import { strings as securityCopy } from './security-strings.ts';
import type { GooglePhotoResult } from './google-photo-result.ts';
import { strings } from './workspace-strings.ts';

/** Props for the Profile page. */
export interface ProfileScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly profile: MyProfile;
  /** A change landed: the route reads the profile again. */
  readonly onChanged: () => Promise<void>;
  /** How a Google photo sync went, once, on the way back from Google (`?google-photo=`). */
  readonly photoResult?: GooglePhotoResult;
  /** Clears `?google-photo=`: once the success toast is up, or when its note is dismissed. */
  readonly onPhotoResultSeen: () => void;
}

/**
 * Your details: their picture with their name beside it (and Sync Google photo where Google sign in is on), the name
 * to change, and the sign in email as plain text. Then the public profile (handle, bio, the page's link) and the
 * Danger zone. The SaveBar at the view's foot only while something changed: Discard puts the saved values back.
 */
export function ProfileScreen({ data, slug, profile, onChanged, photoResult, onPhotoResultSeen }: ProfileScreenProps) {
  // Deleting the account asks for a step up, which reads how this account signs in.
  const security = useAccountSecurity(data.account.security());
  const { toasts } = useRouteContext({ from: '__root__' });
  const [isOpeningGoogle, setOpeningGoogle] = useState(false);
  // Back from Google synced: the toast once, then the result leaves the address so a reload doesn't say it again.
  // Any other result is the page's note (below) until dismissed: it says why, and what to do.
  const saidSynced = useRef(false);
  useEffect(() => {
    if (photoResult !== 'synced' || saidSynced.current) return;
    saidSynced.current = true;
    toasts.toast({ tone: 'success', message: strings.googlePhoto.synced.text() });
    onPhotoResultSeen();
  }, [photoResult, toasts, onPhotoResultSeen]);
  // The names of the workspaces where this account already has a link page (spec 0056, AC-5618). The profile
  // answers their ids only: a workspace's name belongs to the directory, which a member handler may not read, and
  // this browser already holds every workspace it belongs to from `me.get`, cached for the app load. The map is
  // held and the line derived from it in render, so nothing is set during the effect itself.
  const [workspaceNames, setWorkspaceNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let isCurrent = true;
    void data.me.get().then(
      (me) => {
        if (isCurrent) setWorkspaceNames(new Map((me?.workspaces ?? []).map((each) => [each.id, each.name])));
      },
      () => {
        // The line is a courtesy; without it the handle field still works.
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data]);
  // Only the ones this browser can name: an id with no name says nothing useful, so it says nothing.
  const otherPageNames = (profile.otherLinkPages ?? []).flatMap((other) => {
    const name = workspaceNames.get(other.workspaceId);
    return name === undefined ? [] : [name];
  });

  const photoNote: (typeof strings.googlePhoto)[Exclude<GooglePhotoResult, 'synced'>] | undefined =
    photoResult === undefined || photoResult === 'synced' ? undefined : strings.googlePhoto[photoResult];
  // Back from Google with the browser's back button, the page comes out of the back/forward cache as it was left:
  // "Opening Google". Start over.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setOpeningGoogle(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
  // On success the browser leaves for Google and comes back to this page; only a failure to start comes back here.
  const syncGooglePhoto = () => {
    if (isOpeningGoogle || isDirty) return;
    setOpeningGoogle(true);
    data.auth.syncGooglePhoto(`/w/${encodeURIComponent(slug)}/settings/account/profile`).catch((error: unknown) => {
      setOpeningGoogle(false);
      toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
    });
  };
  const [name, setName] = useState(profile.name);
  // The handle starts from the saved one, else a free one made from their name, which they claim by saving.
  const [handle, setHandle] = useState(profile.handle ?? profile.suggestedHandle ?? '');
  const [isClaiming, setClaiming] = useState(false);
  const [bio, setBio] = useState(profile.bio);
  // Their social links (booking socials, 25 Oct 2026): a draft saved with the rest of the page; absent for a member
  // with no sign in of their own.
  // The section loads on its own (socials-slot.tsx) and says whether its draft changed; the page reaches it to save.
  const savedSocials = profile.socials;
  const [socialsDraft, setSocialsDraft] = useState<SocialsDraftState>({ isChanged: false, hasError: false });
  const socialsControl = useRef<SocialsDraftControl | undefined>(undefined);
  const onSocialsDraft = useCallback((state: SocialsDraftState) => {
    setSocialsDraft(state);
  }, []);
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
  const isSocialsDirty = savedSocials !== undefined && socialsDraft.isChanged;
  const isDirty = isNameDirty || isHandleDirty || isBioDirty || isSocialsDirty;
  // Leaving for Google would lose unsaved changes, so the button waits for them, and says so in the row.
  const pictureNote =
    profile.google !== undefined && isDirty
      ? strings.saveBeforeSync
      : profile.google === 'unlinked'
        ? strings.googleUnlinked(profile.email)
        : profile.image !== undefined
          ? strings.fromGoogle
          : profile.google === 'linked'
            ? strings.googleNoPhoto
            : undefined;
  const isNameMissing = name.trim() === '';
  const handleError = isHandleDirty ? handleProblem(wantedHandle) : undefined;
  const isBioWithoutHandle = isBioDirty && profile.handle === undefined && !isHandleDirty;
  const hasSocialsError = savedSocials !== undefined && socialsDraft.hasError;
  const blockedReason = isNameMissing
    ? strings.yourNameMissing
    : handleError !== undefined
      ? strings.handleFix
      : isBioWithoutHandle
        ? strings.bioNeedsHandle
        : hasSocialsError
          ? socialsCopy.fix
          : undefined;

  const send = (change: Parameters<DataLayer['profile']['update']>[1]) => {
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
    // Every link checked as the server will: one that won't save says why under its field, and nothing is sent.
    const links = isSocialsDirty ? socialsControl.current?.collect() : undefined;
    if (links === 'wrong') return;
    send({
      ...(isNameDirty ? { name: name.trim() } : {}),
      ...(isHandleDirty ? { handle: wantedHandle } : {}),
      ...(isBioDirty ? { bio: bio.trim() } : {}),
      ...(links === undefined ? {} : { socials: links }),
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
            socialsControl.current?.discard();
            setFailure(undefined);
          }}
          onFocusAway={() => pageHeading(document)?.focus()}
        />
      }
    >
      {photoNote !== undefined && (
        <Callout
          tone={photoNote.tone}
          title={photoNote.title}
          isAnnounced
          actions={
            <Button variant="ghost" onPress={onPhotoResultSeen}>
              {strings.dismiss}
            </Button>
          }
        >
          {photoNote.text(profile.email)}
        </Callout>
      )}
      {/* A section like the danger zone under it, so the two read as parts of one page with a line between. */}
      <SettingsSection title={strings.detailsSection}>
        <Card>
          {/* Sync Google photo shows where Google sign in is on; without it the row only shows. */}
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
            {...(pictureNote === undefined ? {} : { description: pictureNote })}
          >
            {profile.google === undefined ? undefined : (
              <Button
                variant="secondary"
                provider="google"
                isPending={isOpeningGoogle}
                isDisabled={isDirty}
                onPress={syncGooglePhoto}
                {...(profile.google === 'unlinked' && !isOpeningGoogle
                  ? { label: strings.syncGooglePhotoAndSignIn }
                  : {})}
              >
                {isOpeningGoogle ? strings.openingGoogle : strings.syncGooglePhoto}
              </Button>
            )}
          </SettingsRow>
          <PhotoSwitch data={data} slug={slug} hasPhoto={profile.image !== undefined} />
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
            description={
              profile.handle === undefined
                ? [
                    strings.handleNew,
                    ...(otherPageNames.length === 0 ? [] : [strings.otherLinkPages(otherPageNames)]),
                  ].join(' ')
                : strings.handleKept
            }
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
              // Enter claims the suggestion while Claim shows, else saves.
              onSubmit={profile.handle === undefined && !isHandleDirty ? claim : save}
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
            <SettingsRow
              title={strings.yourPage}
              control="field"
              {...(profile.isPublic === false ? { description: strings.yourPagePrivate } : {})}
            >
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
      {/* Their social links (booking socials, 25 Oct 2026): the person's own, saved with the bar like the bio. */}
      {savedSocials !== undefined && (
        <SocialLinksSectionSlot
          saved={savedSocials}
          isSaving={isSaving}
          onDraft={onSocialsDraft}
          controlRef={socialsControl}
          onEdit={() => {
            setFailure(undefined);
            setJustSaved(false);
          }}
        />
      )}
      {/* What the page at their handle holds (spec 0051) is edited on its own page, beside its phone preview. */}
      <SettingsSection title={linkPageCopy.profileSection} description={linkPageCopy.profileSectionText}>
        <Card>
          <SettingsRow
            title={linkPageCopy.title}
            description={profile.handle === undefined ? linkPageCopy.profileNoHandle : publicProfileUrl(profile.handle)}
          >
            <ButtonLink href={linkPageHref(slug)} icon="pencil" isDisabled={profile.handle === undefined}>
              {linkPageCopy.editLinkPage}
            </ButtonLink>
          </SettingsRow>
        </Card>
      </SettingsSection>
      {/* Last on the person's own page, set apart under its own heading (the owner, 22 October 2026). */}
      <DeleteAccountSection data={data} security={security} />
      {/* An unsaved name isn't lost by leaving the page without a word. */}
      <LeaveGuard isDirty={isDirty} />
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
          <PhotoSwitchPending />
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
      <SocialLinksSectionPending />
      <SettingsSection title={linkPageCopy.profileSection} description={linkPageCopy.profileSectionText}>
        <Card isBusy>
          <SettingsRow title={linkPageCopy.title} description={<Skeleton width="medium" />}>
            <Skeleton shape="field" width="short" />
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
