// Brief
// Purpose: the Design page (spec 0065, AC-6570 as amended): how the business's guest menu, reservation page and business
// page look, beside the real guest menu in a phone.
// Main task: pick a preset, change its colours, fonts, corners or cover if wanted, see it at once, and Save.
// Leaves out: a colour per part of the page, importing a look from an address, and anything about a menu's contents.
import { isDataError, type MenuDraft, type MenuLook, type MenuStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  MENU_FONTS,
  MENU_PALETTE_ROLES,
  MENU_PRESET_LOOKS,
  MENU_PRESETS,
  MENU_RADII,
  MENU_LIMITS,
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
  EmptyState,
  FileDrop,
  MenuList,
  MenuLookThumbnail,
  PreviewLayout,
  SaveBar,
  SegmentedControl,
  Select,
  SettingsRow,
  StatusDot,
  TileGrid,
  TopBar,
  usePhotoCrop,
  type Toasts,
} from '@crm/ui';
import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { publicMenuUrl } from '../booking/links.ts';
import { LeaveGuard } from '../navigation/LeaveGuard.tsx';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { draftPhotoHref, prepareMenuCover } from './photo.ts';
import { previewMenu, sampleMenu } from './preview.ts';
import { strings } from './strings.ts';

/** Props for the Design page. */
export interface DesignScreenProps {
  readonly store: MenuStore;
  readonly slug: string;
  readonly toasts: Toasts;
  readonly businessName: string;
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

/** The real guest menu in the phone, drawn again only when what it shows changes. */
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
      photoHref={(photoId, size, version) => draftPhotoHref(slug, photoId, size, version)}
      {...(coverHref === undefined ? {} : { coverHref })}
    />
  );
});

/** The Design page. */
export function DesignScreen({ store, slug, toasts, businessName }: DesignScreenProps) {
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
  return <DesignBody store={store} slug={slug} toasts={toasts} businessName={businessName} draft={state.value} />;
}

/** The page, once the draft is here. */
function DesignBody({
  store,
  slug,
  toasts,
  businessName,
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
  const isDirty = pending !== undefined || (edited !== undefined && JSON.stringify(edited) !== JSON.stringify(saved));

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
  const palette = menuLookPalette(look, 'light');
  // The buttons' colour as a guest sees it: the owner's, else the brand kit's on a preset that takes it.
  const kitAccent = preset.takesBrandAccent ? accents.accent : undefined;
  const asPicked = { ...palette, brand: look.palette?.brand ?? kitAccent ?? palette.brand };
  const contrast = menuLookContrast(asPicked);
  const fails = Object.values(contrast).some((each) => !each.passes);
  const presetColour = (role: MenuPaletteRole) =>
    role === 'brand' && kitAccent !== undefined ? kitAccent : preset.palette[role];

  const place = draft.places[0];
  const coverHref =
    pending?.src ??
    (look.cover === undefined ? undefined : draftPhotoHref(slug, look.cover.id, 'large', look.cover.version));

  const save = async () => {
    setSaving(true);
    setFailure(undefined);
    try {
      let next = look;
      if (pending !== undefined) {
        const cover = await store.uploadCover(slug, { large: pending.large, small: pending.small });
        if (isDataError(cover)) {
          setFailure(cover.message);
          return;
        }
        next = { ...look, cover };
      }
      const refused = await store.saveLook(slug, next);
      if (refused !== undefined) {
        // The store has put its copy back; what's on screen stays, so Save can try again.
        setEdited(next);
        setPending(undefined);
        setFailure(refused.message);
        return;
      }
      setEdited(undefined);
      setPending(undefined);
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

  const cropCover = (source: File | string) => {
    void cropping.crop(source, 'cover').then(async (crop) => {
      if (crop === undefined) return;
      const photo = await prepareMenuCover(source, crop).catch(() => undefined);
      if (photo === undefined) {
        toasts.toast({ tone: 'danger', message: strings.photoFailed });
        return;
      }
      setPending({ ...photo, src: URL.createObjectURL(photo.small) });
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

  return (
    <WorkspacePage
      currentPage="menus"
      page={{
        topBar: (
          <TopBar
            title={strings.designTitle}
            crumbs={[{ id: 'menus', label: strings.title, href: `/w/${slug}/menus` }]}
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
                fails ? (
                  <Callout tone="warning" title={strings.contrastWarningTitle}>
                    {strings.contrastWarning}
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
                    onSave={() => void save()}
                    onDiscard={discard}
                  />
                ) : undefined
              }
            >
              <Card title={strings.designLook} description={strings.designLookLine}>
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
                      thumbnail: (
                        <MenuLookThumbnail
                          scheme={drawnOn}
                          variables={[...menuLookShape(own), ...menuLookColours(own, accents, drawnOn)]}
                        />
                      ),
                    };
                  })}
                  onChange={(id) => {
                    if ((MENU_PRESETS as readonly string[]).includes(id)) {
                      change(presetLook(id as MenuPreset, look.cover));
                    }
                  }}
                />
              </Card>
              <Card title={strings.designColours}>
                {MENU_PALETTE_ROLES.map((role) => {
                  const check = role === 'surface' ? undefined : contrast[role];
                  return (
                    <SettingsRow
                      key={role}
                      title={strings.roleNames[role]}
                      description={strings.roleLines[role]}
                      {...(check === undefined
                        ? {}
                        : {
                            meta: (
                              <StatusDot hue={check.passes ? 'green' : 'red'}>
                                {check.passes ? strings.contrastPasses(check.ratio) : strings.contrastFails(check.ratio)}
                              </StatusDot>
                            ),
                          })}
                    >
                      <AccentPicker
                        label={strings.roleNames[role]}
                        isLabelHidden
                        hexPlacement="inline"
                        quickPicks={[]}
                        defaultName={strings.presetNames[look.preset]}
                        defaultValue={presetColour(role)}
                        isReadOnly={!canEdit}
                        {...(look.palette?.[role] === undefined ? {} : { value: look.palette[role] })}
                        onChange={(value) => change(withColour(look, role, value))}
                        onPreview={(value) => change(withColour(look, role, value))}
                      />
                    </SettingsRow>
                  );
                })}
              </Card>
              <Card title={strings.designType}>
                <SettingsRow title={strings.headingFont} control="field">
                  <Select
                    label={strings.headingFont}
                    isLabelHidden
                    isDisabled={!canEdit}
                    items={MENU_FONTS.map((font) => ({ id: font, label: strings.fontNames[font] }))}
                    value={look.heading}
                    onChange={(font) => {
                      if (font !== null) change({ ...look, heading: font as MenuFont });
                    }}
                  />
                </SettingsRow>
                <SettingsRow title={strings.bodyFont} control="field">
                  <Select
                    label={strings.bodyFont}
                    isLabelHidden
                    isDisabled={!canEdit}
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
                    isDisabled={!canEdit}
                    value={look.radius}
                    onChange={(radius) => change({ ...look, radius: radius as MenuRadius })}
                    segments={MENU_RADII.map((radius) => ({ value: radius, label: strings.cornerNames[radius] }))}
                  />
                </SettingsRow>
              </Card>
              <Card title={strings.designCover}>
                <FileDrop
                  label={strings.designCover}
                  acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
                  typesText={strings.photoTypes}
                  maxSize={MENU_LIMITS.photoMaxBytes}
                  isDisabled={!canEdit}
                  isPending={isSaving && pending !== undefined}
                  onFiles={(files) => {
                    const [file] = files;
                    if (file !== undefined) cropCover(file);
                  }}
                  {...(coverHref === undefined
                    ? {}
                    : {
                        preview: { src: coverHref, alt: strings.designCover },
                        ...(canEdit
                          ? {
                              onRemove: removeCover,
                              onAdjust: () => cropCover(coverHref),
                            }
                          : {}),
                      })}
                />
                {cropping.cropper}
              </Card>
            </PreviewLayout>
            <LeaveGuard isDirty={isDirty} />
          </>
        ),
      }}
    />
  );
}
