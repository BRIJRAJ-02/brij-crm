// Brief
// Purpose: the link page's Design panel (spec 0068, AC-6802, AC-6804): one of four finished templates, picked by
// seeing each as the page, then the owner's colour, cover photo and face shape, and nothing else.
// Main task: pick a template; the phone beside it crossfades to the page in it at once.
// Leaves out: fonts, grounds, gradients, patterns, row shapes and fills, which each template fixes; and any value of
// its own: every pick is a name from a closed set, and the stylesheet in `packages/ui` is the only place a value lives.
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
  SettingsStack,
  TileGrid,
  type AccentQuickPick,
  type LinkPageThumbnailProfile,
  type PageTemplate,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { BRAND_PHOTO_PICK_MAX_BYTES, BRAND_PHOTO_TYPES } from './photo-prep.ts';
import { strings } from './strings.ts';

/** The four templates in the picker's order, each with its name and the line that says who it suits. */
const TEMPLATES: readonly { readonly id: PageTemplate; readonly name: string; readonly text: string }[] = [
  { id: 'classic', name: strings.templateClassic, text: strings.templateClassicText },
  { id: 'studio', name: strings.templateStudio, text: strings.templateStudioText },
  { id: 'night', name: strings.templateNight, text: strings.templateNightText },
  { id: 'split', name: strings.templateSplit, text: strings.templateSplitText },
];

/** A template's name, as the picker says it. */
function nameOf(template: PageTemplate): string {
  return TEMPLATES.find((one) => one.id === template)?.name ?? strings.templateClassic;
}

/** A page's two photos. */
export type PhotoSlot = 'cover' | 'ground';

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
   * first rows' titles. The cover comes from `extras`. Left out, the pictures draw a sample.
   */
  readonly profile?: LinkPageThumbnailProfile;
}

/**
 * Design (spec 0068, AC-6802, AC-6804, AC-6805): the four templates as large pictures of the page, the one the page
 * wears ringed and ticked; then Colour, Cover photo and Face. A page with no template of its own wears its
 * workspace's, and the picker says so. A page moved to a template by the move says so once, with a way to pick
 * another and a way to keep it.
 */
export function AppearanceCard({ theme, onChange, refusal, extras, profile }: AppearanceCardProps) {
  const [removing, setRemoving] = useState<PhotoSlot | undefined>(undefined);
  const pickerRef = useRef<HTMLDivElement>(null);
  const variables = extras?.variables ?? [];
  const look = extras?.look;
  const workspaceTemplate = look?.workspaceTemplate ?? 'classic';
  const worn = theme.template ?? workspaceTemplate;
  const colours = extras?.colours(look?.accent, look?.accentDark);
  const cover = look?.cover;
  const coverSrc = cover === undefined ? undefined : extras?.photoSrc('cover', cover);
  return (
    <Card
      title={strings.appearance}
      description={strings.appearanceText}
      {...(refusal === undefined ? {} : { footerNote: refusal.message })}
    >
      <SettingsStack variant="plain">
        {/* The move to templates, said once (AC-6805): either answer saves the look without the note. */}
        {theme.moved === true && (
          <Callout
            tone="info"
            title={strings.templateMoved(nameOf(worn))}
            actions={
              <>
                <Button
                  size="md"
                  onPress={() => {
                    pickerRef.current?.querySelector<HTMLInputElement>('input:checked, input')?.focus();
                  }}
                >
                  {strings.templateMovedChoose}
                </Button>
                <Button size="md" variant="ghost" onPress={() => onChange(themeForTemplate(worn, theme))}>
                  {strings.templateMovedKeep}
                </Button>
              </>
            }
          >
            {strings.templateMovedText}
          </Callout>
        )}
        <div ref={pickerRef}>
          <FieldGroup
            label={strings.template}
            {...(theme.template === undefined ? { hint: strings.templateFollows(nameOf(workspaceTemplate)) } : {})}
          >
            {/* Each template as the page in it, in the owner's colour and photos: picked by sight (AC-6804). */}
            <TileGrid
              variant="choice"
              label={strings.template}
              showsDescription
              keepsPicture
              pictureSize="large"
              value={worn}
              tiles={TEMPLATES.map((template) => ({
                id: template.id,
                name: template.name,
                description: template.text,
                thumbnail: (
                  <LinkPageThumbnail
                    theme={themeForTemplate(template.id, theme)}
                    variables={variables}
                    size="large"
                    {...(profile === undefined
                      ? {}
                      : { profile: { ...profile, ...(coverSrc === undefined ? {} : { cover: coverSrc }) } })}
                  />
                ),
              }))}
              onChange={(picked) => {
                const found = TEMPLATES.find((template) => template.id === picked);
                if (found !== undefined) onChange(themeForTemplate(found.id, theme));
              }}
            />
          </FieldGroup>
        </div>
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
        {/* The cover (AC-6802): Studio and Split lead with it; Classic and Night show it when there is one. */}
        <FileDrop
          label={cover === undefined ? strings.coverPhotoDrop : strings.coverPhoto}
          acceptedTypes={BRAND_PHOTO_TYPES}
          typesText={strings.photoTypes}
          maxSize={BRAND_PHOTO_PICK_MAX_BYTES}
          isDisabled={extras === undefined || look === undefined || extras.sending !== undefined}
          {...(coverSrc === undefined
            ? {}
            : {
                preview: { src: coverSrc, alt: strings.photoAlt },
                onAdjust: () => {
                  extras?.onPhoto('cover', coverSrc);
                },
              })}
          onFiles={(files) => {
            const [file] = files;
            if (file !== undefined) extras?.onPhoto('cover', file);
          }}
        />
        {cover !== undefined && (
          <Button variant="ghost" size="md" icon="trash" onPress={() => setRemoving('cover')}>
            {strings.photoRemove}
          </Button>
        )}
        <FieldGroup label={strings.avatar}>
          <TileGrid
            variant="choice"
            label={strings.avatar}
            value={theme.avatar === 'rounded' ? 'rounded' : 'circle'}
            tiles={(
              [
                ['circle', strings.avatarCircle],
                ['rounded', strings.avatarRounded],
              ] as const
            ).map(([id, name]) => ({
              id,
              name,
              thumbnail: (
                <LinkPageThumbnail theme={{ ...themeForTemplate(worn, theme), avatar: id }} variables={variables} />
              ),
            }))}
            onChange={(picked) => {
              if (picked === 'circle' || picked === 'rounded') onChange({ ...theme, avatar: picked });
            }}
          />
        </FieldGroup>
      </SettingsStack>
      <Modal
        isOpen={removing !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRemoving(undefined);
        }}
        title={strings.photoRemoving}
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
        {strings.coverRemoveText}
      </Modal>
    </Card>
  );
}
