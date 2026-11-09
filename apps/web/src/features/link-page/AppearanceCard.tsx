// Brief
// Purpose: the link page's Design panel (spec 0068, AC-6802, AC-6804): one of four finished templates, then the
// owner's colour and the page's three photos (cover, profile photo with its shape, background; 9 Nov 2026), and
// nothing else. Calm by design (owner, 5 November 2026: "too much issues and complicated"): the phone beside it is
// the large live picture of the page, so the controls are small.
// Main task: pick a template; the phone beside it crossfades to the page in it at once.
// Leaves out: fonts, ground colours, gradients, patterns, row shapes and fills, which each template fixes; sentences
// under the templates; and any value of its own: every pick is a name from a closed set or a photo.
import { themeForTemplate, type BrandColours, type DataError, type PageLookExtras, type PageTheme } from '@crm/data';
import {
  AccentPicker,
  Button,
  Callout,
  Card,
  Disclosure,
  FieldGroup,
  FileDrop,
  LinkPageThumbnail,
  Modal,
  SegmentedControl,
  SettingsStack,
  TileGrid,
  type AccentQuickPick,
  type LinkPageThumbnailProfile,
  type PageTemplate,
} from '@crm/ui';
import { useState } from 'react';
import { BRAND_PHOTO_PICK_MAX_BYTES, BRAND_PHOTO_TYPES } from './photo-prep.ts';
import { strings } from './strings.ts';

/** The four templates in the picker's order, each with its name. */
const TEMPLATES: readonly { readonly id: PageTemplate; readonly name: string }[] = [
  { id: 'classic', name: strings.templateClassic },
  { id: 'studio', name: strings.templateStudio },
  { id: 'night', name: strings.templateNight },
  { id: 'split', name: strings.templateSplit },
];

/** What the Remove question says for each photo: which one, and what the page shows instead. */
const REMOVING: Readonly<Record<PhotoSlot, { readonly title: string; readonly text: string }>> = {
  cover: { title: strings.coverRemoving, text: strings.coverRemoveText },
  avatar: { title: strings.avatarRemoving, text: strings.avatarRemoveText },
  ground: { title: strings.groundRemoving, text: strings.groundRemoveText },
};

/** A template's name, as the picker says it. */
function nameOf(template: PageTemplate): string {
  return TEMPLATES.find((one) => one.id === template)?.name ?? strings.templateClassic;
}

/** A page's three photos, in the order they show on it, top to bottom. */
export type PhotoSlot = 'cover' | 'avatar' | 'ground';

/** The page's own colour and photos, and what changes them (spec 0060); absent, the panel draws names alone. */
export interface DesignExtras {
  /** The page's own accent pair and photos, and the workspace accent it follows; undefined while it loads. */
  readonly look: PageLookExtras | undefined;
  /** What an accent pair draws as, for the picker's note (AC-6). */
  readonly colours: (accent?: string, accentDark?: string) => BrandColours | undefined;
  /** The page's variables as the preview holds them, so every tile shows the owner's colour and photos. */
  readonly variables: readonly (readonly [string, string])[];
  readonly quickPicks: readonly AccentQuickPick[];
  /** Where the owner's browser reads one of their photos. */
  readonly photoSrc: (slot: PhotoSlot, version: string) => string | undefined;
  /** A colour picked (undefined follows the workspace), with its dark one; shown at once, then saved. */
  readonly onAccent: (accent: string | undefined, accentDark: string | undefined) => void;
  /** The colour under the system picker's pointer, before it settles. */
  readonly onPreviewAccent: (accent: string) => void;
  /**
   * A photo picked for a slot, or the address of the one there to crop again (spec 0068, AC-6809): the screen opens
   * the cropper on it, draws it again and sends it.
   */
  readonly onPhoto: (slot: PhotoSlot, source: File | string) => void;
  readonly onRemovePhoto: (slot: PhotoSlot) => void;
  /** The slot whose photo is on its way. */
  readonly sending?: PhotoSlot;
}

/** Props for AppearanceCard. */
export interface AppearanceCardProps {
  /** The look as stored, with any pick still on its way already shown. */
  readonly theme: PageTheme;
  /** A pick: shown at once by the caller, then saved. A refusal puts the control back and says why. */
  readonly onChange: (theme: PageTheme) => void;
  /** Why the last pick didn't save, said on the card until the next pick. */
  readonly refusal?: DataError;
  /** The colour and the photos (spec 0060). */
  readonly extras?: DesignExtras;
  /**
   * The owner's page as the template pictures draw it (spec 0068, AC-6804): their name, picture or initials, logo and
   * first rows' titles. The cover, the page's own profile photo and its background come from `extras`. Left out, the pictures draw a sample.
   */
  readonly profile?: LinkPageThumbnailProfile;
}

/**
 * Design (spec 0068, AC-6802, AC-6804, AC-6805), one quiet column: the four templates as small pictures of the page
 * with a name each (the one it wears ringed and ticked; the phone beside is the large live one), then Colour, then
 * the three photos as one row each in the order they show on the page (cover, profile photo with Photo shape under
 * it, background), each saying in a line where it shows. A page with no template of its own wears its workspace's, and
 * the picker says so in three words. A page moved to a template says so once, with Keep it.
 */
export function AppearanceCard({ theme, onChange, refusal, extras, profile }: AppearanceCardProps) {
  const [removing, setRemoving] = useState<PhotoSlot | undefined>(undefined);
  const variables = extras?.variables ?? [];
  const look = extras?.look;
  const workspaceTemplate = look?.workspaceTemplate ?? 'classic';
  const worn = theme.template ?? workspaceTemplate;
  const colours = extras?.colours(look?.accent, look?.accentDark);
  const srcOf = (slot: PhotoSlot) => {
    const version = look?.[slot];
    return version === undefined ? undefined : extras?.photoSrc(slot, version);
  };
  const coverSrc = srcOf('cover');
  const avatarSrc = srcOf('avatar');
  const groundSrc = srcOf('ground');
  // The miniatures draw this page: its own profile photo over the account picture, and its background photo.
  const shownProfile =
    profile === undefined
      ? undefined
      : {
          ...profile,
          ...(coverSrc === undefined ? {} : { cover: coverSrc }),
          ...(avatarSrc === undefined ? {} : { picture: avatarSrc }),
          ...(groundSrc === undefined ? {} : { hasGround: true }),
        };
  /** One photo's row: what is there, Upload or Change, Adjust crop and Remove, and the line saying where it shows. */
  const photoRow = (slot: PhotoSlot, label: string, hint: string, alt: string, src: string | undefined) => (
    <FileDrop
      variant="row"
      label={label}
      description={hint}
      {...(slot === 'avatar' ? { thumb: 'square' as const } : {})}
      acceptedTypes={BRAND_PHOTO_TYPES}
      typesText={strings.photoTypes}
      maxSize={BRAND_PHOTO_PICK_MAX_BYTES}
      isDisabled={extras === undefined || look === undefined}
      isPending={extras?.sending === slot}
      {...(src === undefined
        ? {}
        : {
            preview: { src, alt },
            onAdjust: () => {
              extras?.onPhoto(slot, src);
            },
            onRemove: () => setRemoving(slot),
          })}
      onFiles={(files) => {
        const [file] = files;
        if (file !== undefined) extras?.onPhoto(slot, file);
      }}
    />
  );
  return (
    <Card title={strings.appearance}>
      <SettingsStack variant="plain">
        {/* Why the last pick didn't save, until the next one: the card has no footer to say it in. */}
        {refusal !== undefined && <Callout tone="danger">{refusal.message}</Callout>}
        {/* The move to templates, said once (AC-6805): picking a template, or Keep it, saves the look without it. */}
        {theme.moved === true && (
          <Callout
            tone="info"
            actions={
              <Button size="md" variant="ghost" onPress={() => onChange(themeForTemplate(worn, theme))}>
                {strings.templateMovedKeep}
              </Button>
            }
          >
            {strings.templateMoved(nameOf(worn))}
          </Callout>
        )}
        <FieldGroup
          label={strings.template}
          {...(theme.template === undefined ? { hint: strings.templateFollows(nameOf(workspaceTemplate)) } : {})}
        >
          {/* Each template as a small picture of the page in it, in the owner's colour: the phone is the big one. */}
          <TileGrid
            variant="choice"
            label={strings.template}
            value={worn}
            tiles={TEMPLATES.map((template) => ({
              id: template.id,
              name: template.name,
              thumbnail: (
                <LinkPageThumbnail
                  theme={themeForTemplate(template.id, theme)}
                  variables={variables}
                  {...(shownProfile === undefined ? {} : { profile: shownProfile })}
                />
              ),
            }))}
            onChange={(picked) => {
              const found = TEMPLATES.find((template) => template.id === picked);
              if (found !== undefined) onChange(themeForTemplate(found.id, theme));
            }}
          />
        </FieldGroup>
        {extras !== undefined && (
          <AccentPicker
            label={strings.colour}
            defaultName={strings.colourDefault}
            {...(look?.workspaceAccent === undefined ? {} : { defaultValue: look.workspaceAccent })}
            {...(look?.accent === undefined ? {} : { value: look.accent })}
            quickPicks={extras.quickPicks}
            isDisabled={look === undefined}
            {...(colours?.adjusted === true ? { drawn: { light: colours.light, dark: colours.dark } } : {})}
            onPreview={extras.onPreviewAccent}
            onChange={(accent) => {
              extras.onAccent(accent, accent === undefined ? undefined : look?.accentDark);
            }}
          >
            {/* A separate colour for dark pages (AC-6), once there is a colour of the page's own to set it beside. */}
            {look?.accent !== undefined && (
              <Disclosure title={strings.colourMore} variant="quiet">
                <AccentPicker
                  label={strings.colourMore}
                  defaultName={strings.colourDarkDefault}
                  {...(look.accentDark === undefined ? {} : { value: look.accentDark })}
                  quickPicks={extras.quickPicks}
                  onChange={(accentDark) => {
                    extras.onAccent(look.accent, accentDark);
                  }}
                />
              </Disclosure>
            )}
          </AccentPicker>
        )}
        {/* The page's photos, in the order they show on it (owner's team, 9 Nov 2026), each saying where in one line:
            the cover (AC-6802; Studio and Split lead with it, Classic and Night show it when there is one), the
            profile photo with the shape it takes, then the background behind every template. */}
        {photoRow('cover', strings.coverPhoto, strings.coverPhotoHint, strings.coverAlt, coverSrc)}
        {photoRow('avatar', strings.avatarPhoto, strings.avatarPhotoHint, strings.avatarAlt, avatarSrc)}
        <SegmentedControl
          label={strings.avatar}
          isLabelVisible
          size="compact"
          value={theme.avatar === 'rounded' ? 'rounded' : 'circle'}
          onChange={(picked) => {
            if (picked === 'circle' || picked === 'rounded') onChange({ ...theme, avatar: picked });
          }}
          segments={[
            { value: 'circle', label: strings.avatarCircle },
            { value: 'rounded', label: strings.avatarRounded },
          ]}
        />
        {photoRow('ground', strings.groundPhoto, strings.groundPhotoHint, strings.groundAlt, groundSrc)}
      </SettingsStack>
      <Modal
        isOpen={removing !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRemoving(undefined);
        }}
        title={REMOVING[removing ?? 'cover'].title}
        variant="confirm"
        tone="danger"
        actions={
          <>
            <Button variant="ghost" onPress={() => setRemoving(undefined)}>
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                if (removing !== undefined) extras?.onRemovePhoto(removing);
                setRemoving(undefined);
              }}
            >
              {strings.photoRemove}
            </Button>
          </>
        }
      >
        {REMOVING[removing ?? 'cover'].text}
      </Modal>
    </Card>
  );
}
