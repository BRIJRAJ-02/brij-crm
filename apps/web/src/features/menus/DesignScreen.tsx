// Brief
// Purpose: the Design page (spec 0065, AC-6570 as amended): how the business's guest menu, reservation page and business
// page look, beside the real guest menu in a phone.
// Main task: pick a preset, change its colours, fonts, corners or cover if wanted, see it at once, and Save.
// Leaves out: a colour per part of the page, importing a look from an address, and anything about a menu's contents.
import { isDataError, type HospitalityStore, type MenuDraft, type MenuLook, type MenuStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  MENU_FONTS,
  MENU_LIMITS,
  MENU_PALETTE_ROLES,
  MENU_PRESET_LOOKS,
  MENU_PRESETS,
  MENU_RADII,
  menuLookColours,
  menuLookContrast,
  menuLookPalette,
  menuLookScheme,
  menuLookShape,
  presetLook,
  type MenuFont,
  type MenuPaletteRole,
  type MenuPreset,
  type MenuRadius,
} from '@crm/data/menu';
import {
  AccentPicker,
  ButtonLink,
  Callout,
  Card,
  ContrastBadge,
  EmptyState,
  FileDrop,
  MenuList,
  MenuLookThumbnail,
  PreviewLayout,
  SaveBar,
  SegmentedControl,
  Select,
  SettingsRow,
  SettingsSection,
  TileGrid,
  TopBar,
  usePhotoCrop,
  ViewOnlyTag,
  type GuestPick,
  type Toasts,
} from '@crm/ui';
import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { publicMenuUrl } from '../booking/links.ts';
import { LeaveGuard } from '../navigation/LeaveGuard.tsx';
import { SwitchGuard } from '../hospitality/SwitchGuard.tsx';
import { strings as hospitalityStrings } from '../hospitality/strings.ts';
import { pageHeading } from '../navigation/focus.ts';
import { businessSettingsHref } from '../settings/nav.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { draftPhotoHref, prepareMenuCover } from './photo.ts';
import { previewMenu, sampleMenu } from './preview.ts';
import { strings } from './strings.ts';

/** Props for the Design page. */
export interface DesignScreenProps {
  readonly store: MenuStore;
  /** The suite's store, so unsaved changes hold a switch of business (spec 0065 H7); left out, nothing holds it. */
  readonly hospitality?: HospitalityStore;
  readonly slug: string;
  readonly toasts: Toasts;
  readonly businessName: string;
  /** Whether the workspace has a business to save a look on; left out for a reader who can't tell, and can't save. */
  readonly hasBusiness?: boolean;
}

/** A cover chosen and cropped, waiting for Save: both widths, and a local picture of it. */
interface PendingCover {
  readonly large: Blob;
  readonly small: Blob;
  readonly src: string;
}

/** How long Save stays in its "Saved" state. */
const SAVED_FOR_MS = 2000;

/** The look with one colour picked, or put back to the preset's: no empty palette is kept. */
function withColour(look: MenuLook, role: MenuPaletteRole, value: string | undefined): MenuLook {
  const { [role]: _was, ...rest } = look.palette ?? {};
  const palette = value === undefined ? rest : { ...rest, [role]: value };
  const { palette: _palette, ...others } = look;
  return Object.keys(palette).length === 0 ? others : { ...others, palette };
}

/** Two looks with the same choices read the same here, whatever order their keys were written in. */
const stampOf = (look: MenuLook): string =>
  JSON.stringify([
    look.preset,
    look.heading,
    look.body,
    look.radius,
    MENU_PALETTE_ROLES.map((role) => look.palette?.[role] ?? ''),
    look.cover?.id ?? '',
  ]);

/** The real guest menu in the phone, drawn again only when what it shows changes. Its picks are this phone's alone. */
const DesignPreview = memo(function DesignPreview({
  draft,
  businessName,
  look,
  scheme,
  coverHref,
  slug,
}: {
  readonly draft: MenuDraft;
  readonly businessName: string;
  readonly look: MenuLook;
  readonly scheme: 'light' | 'dark';
  readonly coverHref?: string;
  readonly slug: string;
}) {
  const place = draft.places[0];
  const [picks, setPicks] = useState<readonly GuestPick[]>([]);
  const menu = useMemo(() => {
    if (place === undefined) return undefined;
    const real = previewMenu(draft, place, { businessName });
    return Object.keys(real.menu.items).length === 0 ? sampleMenu(draft, place, businessName) : real;
  }, [draft, place, businessName]);
  const variables = useMemo(
    () => [...menuLookShape(look), ...menuLookColours(look, draft.lookAccents, scheme)],
    [look, draft.lookAccents, scheme],
  );
  if (menu === undefined) return null;
  return (
    <MenuList
      menu={menu}
      scheme={scheme}
      lookVariables={variables}
      picks={picks}
      onPicksChange={setPicks}
      photoHref={(photoId, size, version) => draftPhotoHref(slug, photoId, size, version)}
      {...(coverHref === undefined ? {} : { coverHref })}
    />
  );
});

/** The Design page. */
export function DesignScreen({ store, hospitality, slug, toasts, businessName, hasBusiness }: DesignScreenProps) {
  const state = useHospitality(store.draft(slug));
  const topBar = (isLoading: boolean) => (
    <TopBar
      title={strings.designTitle}
      crumbs={[{ id: 'menus', label: strings.title, href: `/w/${slug}/menus` }]}
      {...(isLoading ? { isLoading } : {})}
    />
  );
  if (state.status === 'loading') {
    return (
      <WorkspacePage
        currentPage="menus"
        page={{ topBar: topBar(true), body: <EmptyState title={strings.designTitle} isLoading /> }}
      />
    );
  }
  if (state.status === 'error') {
    return (
      <WorkspacePage
        currentPage="menus"
        page={{
          topBar: topBar(false),
          body: (
            <EmptyState tone="error" title={strings.failed} onRetry={() => store.draft(slug).retry()}>
              {state.error.message}
            </EmptyState>
          ),
        }}
      />
    );
  }
  return (
    <DesignBody
      store={store}
      {...(hospitality === undefined ? {} : { hospitality })}
      slug={slug}
      toasts={toasts}
      businessName={businessName}
      {...(hasBusiness === undefined ? {} : { hasBusiness })}
      draft={state.value}
    />
  );
}

/** The page, once the draft is here. */
function DesignBody({
  store,
  hospitality,
  slug,
  toasts,
  businessName,
  hasBusiness = true,
  draft,
}: DesignScreenProps & { readonly draft: MenuDraft }) {
  // The look on screen: what was saved until something changes. UI state until Save, as a half made look is nobody's.
  const [edited, setEdited] = useState<MenuLook | undefined>();
  const [pending, setPending] = useState<PendingCover | undefined>();
  const [isSaving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [previewSide, setPreviewSide] = useState<'light' | 'dark'>('light');
  const cropping = usePhotoCrop();
  const saved = draft.look;
  const look = edited ?? saved;
  // The phone follows a beat behind the pointer, so dragging a colour never holds it back.
  const shown = useDeferredValue(look);
  const canEdit = draft.canEdit;
  const isDirty = pending !== undefined || (edited !== undefined && stampOf(edited) !== stampOf(saved));

  useEffect(() => {
    if (pending === undefined) return undefined;
    return () => URL.revokeObjectURL(pending.src);
  }, [pending]);
  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = globalThis.setTimeout(() => setJustSaved(false), SAVED_FOR_MS);
    return () => globalThis.clearTimeout(timer);
  }, [justSaved]);

  const change = (next: MenuLook) => {
    setEdited(next);
    setFailure(undefined);
    setJustSaved(false);
  };

  const scheme = menuLookScheme(look);
  const side = scheme === 'follow' ? previewSide : scheme;
  const preset = MENU_PRESET_LOOKS[look.preset];
  const accents = draft.lookAccents;
  // The buttons' colour on one side, as picked: the owner's, else the brand kit's on a preset that takes it.
  const kitAccent = (mode: 'light' | 'dark') =>
    !preset.takesBrandAccent ? undefined : mode === 'light' ? accents.accent : accents.accentDark;
  const pickedOn = (mode: 'light' | 'dark') => {
    const palette = menuLookPalette(look, mode);
    return { ...palette, brand: look.palette?.brand ?? kitAccent(mode) ?? palette.brand };
  };
  // A look that follows the guest is read on both sides, and a role shows the worse of the two.
  const contrasts = (scheme === 'follow' ? (['light', 'dark'] as const) : [side]).map((mode) =>
    menuLookContrast(pickedOn(mode)),
  );
  const contrastOf = (role: Exclude<MenuPaletteRole, 'surface'>) =>
    contrasts
      .map((each) => each[role])
      .reduce((worse, each) => (!each.passes && worse.passes ? each : each.ratio < worse.ratio ? each : worse));
  const fails = contrasts.some((each) => Object.values(each).some((check) => !check.passes));
  const presetColour = (role: MenuPaletteRole) => {
    const own = menuLookPalette(presetLook(look.preset), side)[role];
    return role === 'brand' ? (kitAccent(side) ?? own) : own;
  };

  const place = draft.places[0];
  const coverHref =
    pending?.src ??
    (look.cover === undefined ? undefined : draftPhotoHref(slug, look.cover.id, 'large', look.cover.version));
  const hasSampleDishes = draft.sections.every((section) => section.itemIds.length === 0);

  const save = async () => {
    setSaving(true);
    setFailure(undefined);
    // What this save sends. A change made while it was on its way stays on screen, still to be saved.
    const sentLook = look;
    const sentCover = pending;
    try {
      let next = sentLook;
      if (sentCover !== undefined) {
        const cover = await store.uploadCover(slug, { large: sentCover.large, small: sentCover.small });
        if (isDataError(cover)) {
          setFailure(cover.message);
          return;
        }
        next = { ...sentLook, cover };
        // Kept already: a save tried again never sends the picture twice.
        setEdited((now) => (now === undefined || now === sentLook ? next : { ...now, cover }));
        setPending((now) => (now === sentCover ? undefined : now));
      }
      const refused = await store.saveLook(slug, next);
      if (refused !== undefined) {
        // The store has put its copy back; what's on screen stays, so Save can try again.
        setEdited((now) => now ?? next);
        setFailure(refused.message);
        return;
      }
      setEdited((now) => (now === undefined || now === sentLook || now === next ? undefined : now));
      setJustSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setEdited(undefined);
    setPending(undefined);
    setFailure(undefined);
  };

  const choosePreset = (id: MenuPreset) => {
    const before = look;
    const next = presetLook(id, look.cover);
    change(next);
    // A preset replaces what was changed by hand, which Discard alone can't bring back when it was never saved.
    if (stampOf(before) !== stampOf(presetLook(before.preset, before.cover))) {
      toasts.toast({
        tone: 'info',
        message: strings.presetChosen(strings.presetNames[id]),
        action: { label: strings.undo, onAction: () => change(before) },
      });
    }
  };

  const cropCover = (source: File | string) => {
    void cropping.crop(source, 'cover').then(async (crop) => {
      if (crop === undefined) return;
      const photo = await prepareMenuCover(source, crop).catch(() => undefined);
      if (photo === undefined) {
        toasts.toast({ tone: 'danger', message: strings.photoFailed });
        return;
      }
      setPending({ ...photo, src: URL.createObjectURL(photo.large) });
      setFailure(undefined);
      setJustSaved(false);
    });
  };

  const removeCover = () => {
    setPending(undefined);
    const { cover: _cover, ...rest } = look;
    change(rest);
  };

  const status = isSaving
    ? 'saving'
    : isDirty
      ? failure === undefined
        ? 'unsaved'
        : 'error'
      : justSaved
        ? 'saved'
        : 'hidden';

  const needsBusiness = canEdit && (!hasBusiness || place === undefined);

  return (
    <WorkspacePage
      currentPage="menus"
      page={{
        topBar: (
          <TopBar
            title={strings.designTitle}
            crumbs={[{ id: 'menus', label: strings.title, href: `/w/${slug}/menus` }]}
            {...(canEdit ? {} : { meta: <ViewOnlyTag reason={strings.designViewOnly} /> })}
          >
            {draft.publishedAt === undefined || place === undefined ? null : (
              <ButtonLink href={publicMenuUrl(place.menuKey)} isExternal icon="external-link">
                {strings.view}
              </ButtonLink>
            )}
          </TopBar>
        ),
        body: (
          <>
            <PreviewLayout
              previewShare="wide"
              notices={
                needsBusiness ? (
                  <Callout
                    tone="warning"
                    title={strings.designNeedsBusiness}
                    actions={<ButtonLink href={businessSettingsHref(slug)}>{strings.designAddBusiness}</ButtonLink>}
                  >
                    {strings.designNeedsBusinessLine}
                  </Callout>
                ) : undefined
              }
              previewControls={
                scheme === 'follow' ? (
                  <SegmentedControl
                    label={strings.previewSide}
                    size="compact"
                    value={previewSide}
                    onChange={(value) => setPreviewSide(value === 'dark' ? 'dark' : 'light')}
                    segments={[
                      { value: 'light', label: strings.sideLight },
                      { value: 'dark', label: strings.sideDark },
                    ]}
                  />
                ) : undefined
              }
              previewNote={hasSampleDishes ? <Callout tone="info">{strings.sampleNote}</Callout> : undefined}
              preview={
                place === undefined ? undefined : (
                  <DesignPreview
                    draft={draft}
                    businessName={businessName}
                    look={shown}
                    scheme={side}
                    slug={slug}
                    {...(coverHref === undefined ? {} : { coverHref })}
                  />
                )
              }
              footer={
                canEdit ? (
                  <SaveBar
                    status={status}
                    {...(failure === undefined ? {} : { error: failure })}
                    {...(needsBusiness ? { blockedReason: strings.designNeedsBusiness } : {})}
                    onSave={() => void save()}
                    onDiscard={discard}
                    onFocusAway={() => pageHeading(document)?.focus()}
                  />
                ) : undefined
              }
            >
              <SettingsSection title={strings.designLook} description={strings.designLookLine}>
                <Card>
                  <TileGrid
                    variant="choice"
                    label={strings.designLook}
                    keepsPicture
                    value={look.preset}
                    tiles={MENU_PRESETS.map((id) => {
                      const own = presetLook(id);
                      const ownScheme = MENU_PRESET_LOOKS[id].scheme;
                      const drawnOn = ownScheme === 'follow' ? 'light' : ownScheme;
                      return {
                        id,
                        name: strings.presetNames[id],
                        isDisabled: !canEdit,
                        ...(canEdit ? {} : { disabledReason: strings.designViewOnly }),
                        thumbnail: (
                          <MenuLookThumbnail
                            scheme={drawnOn}
                            variables={[...menuLookShape(own), ...menuLookColours(own, accents, drawnOn)]}
                          />
                        ),
                      };
                    })}
                    onChange={(id) => {
                      if ((MENU_PRESETS as readonly string[]).includes(id)) choosePreset(id as MenuPreset);
                    }}
                  />
                </Card>
              </SettingsSection>
              <SettingsSection title={strings.designColours}>
                <Card>
                  {MENU_PALETTE_ROLES.map((role) => {
                    const check = role === 'surface' ? undefined : contrastOf(role);
                    return (
                      <SettingsRow
                        key={role}
                        title={strings.roleNames[role]}
                        description={strings.roleLines[role]}
                        {...(check === undefined
                          ? {}
                          : { meta: <ContrastBadge ratio={check.ratio} passes={check.passes} /> })}
                      >
                        <AccentPicker
                          label={strings.roleNames[role]}
                          isLabelHidden
                          hexPlacement="inline"
                          quickPicks={[]}
                          defaultName={strings.presetNames[look.preset]}
                          defaultValue={presetColour(role)}
                          hexPlaceholder={presetColour(role)}
                          isReadOnly={!canEdit}
                          {...(look.palette?.[role] === undefined ? {} : { value: look.palette[role] })}
                          onChange={(value) => change(withColour(look, role, value))}
                          onPreview={(value) => change(withColour(look, role, value))}
                        />
                      </SettingsRow>
                    );
                  })}
                  {fails ? (
                    <Callout tone="warning" title={strings.contrastWarningTitle} isAnnounced>
                      {strings.contrastWarning}
                    </Callout>
                  ) : null}
                </Card>
              </SettingsSection>
              <SettingsSection title={strings.designType}>
                <Card>
                  <SettingsRow title={strings.headingFont} control="compact">
                    <Select
                      label={strings.headingFont}
                      isLabelHidden
                      isReadOnly={!canEdit}
                      items={MENU_FONTS.map((font) => ({ id: font, label: strings.fontNames[font] }))}
                      value={look.heading}
                      onChange={(font) => {
                        if (font !== null) change({ ...look, heading: font as MenuFont });
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow title={strings.bodyFont} control="compact">
                    <Select
                      label={strings.bodyFont}
                      isLabelHidden
                      isReadOnly={!canEdit}
                      items={MENU_FONTS.map((font) => ({ id: font, label: strings.fontNames[font] }))}
                      value={look.body}
                      onChange={(font) => {
                        if (font !== null) change({ ...look, body: font as MenuFont });
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow title={strings.corners}>
                    <SegmentedControl
                      label={strings.corners}
                      isReadOnly={!canEdit}
                      value={look.radius}
                      onChange={(radius) => change({ ...look, radius: radius as MenuRadius })}
                      segments={MENU_RADII.map((radius) => ({ value: radius, label: strings.cornerNames[radius] }))}
                    />
                  </SettingsRow>
                </Card>
              </SettingsSection>
              {canEdit || coverHref !== undefined ? (
                <SettingsSection title={strings.designCover}>
                  <Card>
                    <FileDrop
                      label={coverHref === undefined ? strings.coverDrop : strings.designCover}
                      acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
                      typesText={strings.photoTypes}
                      maxSize={MENU_LIMITS.photoMaxBytes}
                      isReadOnly={!canEdit}
                      isPending={isSaving && pending !== undefined}
                      onFiles={(files) => {
                        const [file] = files;
                        if (file !== undefined) cropCover(file);
                      }}
                      // With a cover, the row: its picture, Change, Adjust crop and the × that takes it off.
                      {...(coverHref === undefined
                        ? {}
                        : {
                            variant: 'row' as const,
                            preview: { src: coverHref, alt: strings.designCover },
                            ...(canEdit ? { onRemove: removeCover, onAdjust: () => cropCover(coverHref) } : {}),
                          })}
                    />
                    {cropping.cropper}
                  </Card>
                </SettingsSection>
              ) : null}
            </PreviewLayout>
            <LeaveGuard isDirty={isDirty} />
            {hospitality !== undefined && (
              <SwitchGuard
                store={hospitality}
                slug={slug}
                isDirty={isDirty}
                text={hospitalityStrings.discardDesignText}
              />
            )}
          </>
        ),
      }}
    />
  );
}
