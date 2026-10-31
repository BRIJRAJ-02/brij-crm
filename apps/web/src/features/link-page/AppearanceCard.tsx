// Brief
// Purpose: the link page's Design panel (spec 0054, widened by spec 0060): a look picked by sight and seen at once.
// Main task: pick one of the 14 looks, then change any key of it under Customise (colour, background, font, buttons,
// header, mode), each a row of pictures of the page in that choice, and add a cover or background photo.
// Leaves out: any colour, size or font of its own beyond the one accent; every pick is a name from a closed set, and
// the stylesheet in `packages/ui` is the only place a value lives.
import {
  DEFAULT_PAGE_THEME,
  PAGE_THEME_PRESETS,
  sameTheme,
  type BrandColours,
  type DataError,
  type PageLookExtras,
  type PageTheme,
} from '@crm/data';
import {
  AccentPicker,
  Button,
  Card,
  Disclosure,
  FieldGroup,
  FileDrop,
  HuePicker,
  LinkPageThumbnail,
  Modal,
  TileGrid,
  type AccentQuickPick,
  type Hue,
} from '@crm/ui';
import { useState } from 'react';
import { BRAND_PHOTO_PICK_MAX_BYTES, BRAND_PHOTO_TYPES } from './photo-prep.ts';
import { strings } from './strings.ts';

/** What each starting point is called. The list's order is the contracts' own, so the two can't fall apart. */
const PRESET_NAMES: Record<(typeof PAGE_THEME_PRESETS)[number]['id'], string> = {
  plain: strings.presetPlain,
  paper: strings.presetPaper,
  bold: strings.presetBold,
  ink: strings.presetInk,
  quiet: strings.presetQuiet,
  dawn: strings.presetDawn,
  ocean: strings.presetOcean,
  mint: strings.presetMint,
  studio: strings.presetStudio,
  editorial: strings.presetEditorial,
  night: strings.presetNight,
  peach: strings.presetPeach,
  graphite: strings.presetGraphite,
  gallery: strings.presetGallery,
};

/** One choice of a Customise row: its tile's id and name, and the look it makes from the one on the page. */
interface Choice {
  readonly id: string;
  readonly name: string;
  readonly apply: (theme: PageTheme) => PageTheme;
}

/** A row's choices for one key, each setting that key alone. */
function choicesOf<Key extends keyof PageTheme>(
  key: Key,
  names: readonly (readonly [PageTheme[Key], string])[],
): readonly Choice[] {
  return names.map(([value, name]) => ({ id: value, name, apply: (theme) => ({ ...theme, [key]: value }) }));
}

/** The backgrounds: the four grounds, the eight gradients, the four patterns and the photo, in one row (AC-10). */
const GROUNDS: readonly Choice[] = [
  ...choicesOf('ground', [
    ['plain', strings.groundPlain],
    ['paper', strings.groundPaper],
    ['tint', strings.groundTint],
    ['ink', strings.groundInk],
  ]),
  ...(
    [
      ['dawn', strings.gradientDawn],
      ['dusk', strings.gradientDusk],
      ['mint', strings.gradientMint],
      ['ocean', strings.gradientOcean],
      ['peach', strings.gradientPeach],
      ['grape', strings.gradientGrape],
      ['sand', strings.gradientSand],
      ['graphite', strings.gradientGraphite],
    ] as const
  ).map(([gradient, name]) => ({
    id: `gradient-${gradient}`,
    name,
    apply: (theme: PageTheme): PageTheme => ({ ...theme, ground: 'gradient', gradient }),
  })),
  ...(
    [
      ['dots', strings.patternDots],
      ['grid', strings.patternGrid],
      ['lines', strings.patternLines],
      ['waves', strings.patternWaves],
    ] as const
  ).map(([pattern, name]) => ({
    id: `pattern-${pattern}`,
    name,
    apply: (theme: PageTheme): PageTheme => ({ ...theme, ground: 'pattern', pattern }),
  })),
  ...choicesOf('ground', [['image', strings.groundImage]]),
];

/** The background tile a look stands on. */
function groundId(theme: PageTheme): string {
  if (theme.ground === 'gradient') return `gradient-${theme.gradient}`;
  if (theme.ground === 'pattern') return `pattern-${theme.pattern}`;
  return theme.ground;
}

const FONTS = choicesOf('font', [
  ['sans', strings.fontSans],
  ['mono', strings.fontMono],
  ['grotesk', strings.fontGrotesk],
  ['editorial', strings.fontEditorial],
  ['classic', strings.fontClassic],
  ['friendly', strings.fontFriendly],
  ['geometric', strings.fontGeometric],
  ['display', strings.fontDisplay],
]);

const FILLS = choicesOf('fill', [
  ['plain', strings.fillPlain],
  ['soft', strings.fillSoft],
  ['outline', strings.fillOutline],
  ['solid', strings.fillSolid],
]);

const SHAPES = choicesOf('shape', [
  ['soft', strings.shapeSoft],
  ['pill', strings.shapePill],
  ['square', strings.shapeSquare],
]);

const HEADERS = choicesOf('header', [
  ['centred', strings.headerCentred],
  ['cover', strings.headerCover],
  ['left', strings.headerLeft],
]);

const AVATARS = choicesOf('avatar', [
  ['circle', strings.avatarCircle],
  ['rounded', strings.avatarRounded],
  ['none', strings.avatarNone],
]);

const MODES = choicesOf('mode', [
  ['light', strings.modeLight],
  ['dark', strings.modeDark],
  ['system', strings.modeSystem],
]);

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
  /** A photo picked for a slot: the screen draws it again and sends it. */
  readonly onPhoto: (slot: PhotoSlot, file: File) => void;
  readonly onRemovePhoto: (slot: PhotoSlot) => void;
  /** The slot whose photo is on its way. */
  readonly sending?: PhotoSlot;
}

/** Props for AppearanceCard. */
export interface AppearanceCardProps {
  /** The look as the page is drawn now, with any pick still on its way already shown. */
  readonly theme: PageTheme;
  /** A pick: shown at once by the caller, then saved. A refusal puts the control back and says why. */
  readonly onChange: (theme: PageTheme) => void;
  /** Why the last pick didn't save, said on the card until the next pick. */
  readonly refusal?: DataError;
  /** The colour and the photos (spec 0060). */
  readonly extras?: DesignExtras;
}

/**
 * Design (AC-5420; spec 0060, AC-8, AC-9): 14 looks as pictures of the page, then Customise, rows of pictures of the
 * page in each choice. Each pick shows at once in the phone beside it and saves once the picking stops.
 */
export function AppearanceCard({ theme, onChange, refusal, extras }: AppearanceCardProps) {
  const [isCustomising, setCustomising] = useState(false);
  const [removing, setRemoving] = useState<PhotoSlot | undefined>(undefined);
  const variables = extras?.variables ?? [];
  const look = extras?.look;
  const pick = (next: PageTheme) => {
    onChange(next);
  };
  /** One row of pictures: the page as it is, with this one choice made. */
  const row = (label: string, choices: readonly Choice[], value: string) => (
    // The row's name over its pictures, as a field's label sits over its field.
    <FieldGroup label={label}>
      <TileGrid
        variant="choice"
        label={label}
        value={value}
        tiles={choices.map((choice) => ({
          id: choice.id,
          name: choice.name,
          thumbnail: <LinkPageThumbnail theme={choice.apply(theme)} variables={variables} />,
        }))}
        onChange={(picked) => {
          const found = choices.find((choice) => choice.id === picked);
          if (found !== undefined) pick(found.apply(theme));
        }}
      />
    </FieldGroup>
  );
  /** A slot's picker, with what is there now as its preview so nobody replaces a photo they cannot see. */
  const photo = (slot: PhotoSlot) => {
    const version = look?.[slot];
    const src = version === undefined ? undefined : extras?.photoSrc(slot, version);
    const label =
      slot === 'cover'
        ? version === undefined
          ? strings.coverPhotoDrop
          : strings.coverPhoto
        : version === undefined
          ? strings.groundPhotoDrop
          : strings.groundPhoto;
    return (
      <>
        <FileDrop
          label={label}
          acceptedTypes={BRAND_PHOTO_TYPES}
          maxSize={BRAND_PHOTO_PICK_MAX_BYTES}
          isDisabled={extras === undefined || look === undefined || extras.sending !== undefined}
          {...(src === undefined ? {} : { preview: { src, alt: strings.photoAlt } })}
          onFiles={(files) => {
            const [file] = files;
            if (file !== undefined) extras?.onPhoto(slot, file);
          }}
        />
        {version !== undefined && (
          <Button variant="ghost" size="md" icon="trash" onPress={() => setRemoving(slot)}>
            {strings.photoRemove}
          </Button>
        )}
      </>
    );
  };
  // The starting point a person is standing on, or none once they have changed a key under it. Worked out from
  // the keys rather than remembered, since the name is never stored (AC-5420).
  const standing = PAGE_THEME_PRESETS.find((preset) => sameTheme(preset.theme, theme));
  const colours = extras?.colours(look?.accent, look?.accentDark);
  return (
    <Card
      title={strings.appearance}
      description={strings.appearanceText}
      actions={<Button onPress={() => pick(DEFAULT_PAGE_THEME)}>{strings.reset}</Button>}
      {...(refusal === undefined ? {} : { footerNote: refusal.message })}
    >
      {/* Each look as a picture of the page in it, its name under it: picked by sight, and the chosen one ringed
          and ticked. None is ticked once a row below changes a key under it. Gallery needs its photos, so picking
          it without them opens Customise, where they are added. */}
      <TileGrid
        variant="choice"
        label={strings.startingPoint}
        value={standing?.id ?? null}
        tiles={PAGE_THEME_PRESETS.map((preset) => ({
          id: preset.id,
          name: PRESET_NAMES[preset.id],
          thumbnail: <LinkPageThumbnail theme={preset.theme} variables={variables} />,
        }))}
        onChange={(picked) => {
          const found = PAGE_THEME_PRESETS.find((preset) => preset.id === picked);
          if (found === undefined) return;
          pick(found.theme);
          if (found.theme.ground === 'image' && look?.ground === undefined) setCustomising(true);
        }}
      />
      <Disclosure
        title={strings.customise}
        variant="quiet"
        isExpanded={isCustomising}
        onExpandedChange={setCustomising}
      >
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
        {row(strings.ground, GROUNDS, groundId(theme))}
        {/* The tint takes the person's hue, which changes nothing under any other background. */}
        {theme.ground === 'tint' && (
          <HuePicker
            isLabelShown
            label={strings.hue}
            value={theme.hue}
            onChange={(hue: Hue) => {
              pick({ ...theme, hue });
            }}
          />
        )}
        {theme.ground === 'image' && photo('ground')}
        {row(strings.font, FONTS, theme.font)}
        {row(strings.fill, FILLS, theme.fill)}
        {row(strings.shape, SHAPES, theme.shape)}
        {row(strings.header, HEADERS, theme.header)}
        {theme.header === 'cover' && photo('cover')}
        {row(strings.avatar, AVATARS, theme.avatar)}
        {row(strings.mode, MODES, theme.mode)}
      </Disclosure>
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
        {removing === 'cover' ? strings.coverRemoveText : strings.photoRemoveText}
      </Modal>
    </Card>
  );
}
