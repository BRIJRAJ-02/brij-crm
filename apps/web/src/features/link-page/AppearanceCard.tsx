// Brief
// Purpose: the link page's Design panel (spec 0068, AC-6802, AC-6804): one of four finished templates, then the
// owner's colour, the profile photo's shape and the background photo, and nothing else. The profile photo and the
// cover sit with the name in the Profile card at the top (owner, 10 Nov 2026, Linktree style). Calm by design
// (owner, 5 November 2026: "too much issues and complicated"): the phone beside it is the large live picture of the
// page, so the controls are small.
// Main task: pick a template; the phone beside it crossfades to the page in it at once.
// Leaves out: fonts, ground colours, gradients, patterns, row shapes and fills, which each template fixes; sentences
// under the templates; and any value of its own: every pick is a name from a closed set or a photo.
import { themeForTemplate, type BrandColours, type DataError, type PageTheme } from '@crm/data';
import {
  AccentPicker,
  Button,
  Callout,
  Card,
  Disclosure,
  FieldGroup,
  LinkPageThumbnail,
  SegmentedControl,
  SettingsStack,
  TileGrid,
  type AccentQuickPick,
  type LinkPageThumbnailProfile,
  type PageTemplate,
} from '@crm/ui';
import { PagePhotos, photoSrcOf, type PhotoExtras } from './PagePhotos.tsx';
import { strings } from './strings.ts';

export type { PhotoSlot } from './PagePhotos.tsx';

/** The four templates in the picker's order, each with its name. */
const TEMPLATES: readonly { readonly id: PageTemplate; readonly name: string }[] = [
  { id: 'classic', name: strings.templateClassic },
  { id: 'studio', name: strings.templateStudio },
  { id: 'night', name: strings.templateNight },
  { id: 'split', name: strings.templateSplit },
];

/** A template's name, as the picker says it. */
function nameOf(template: PageTemplate): string {
  return TEMPLATES.find((one) => one.id === template)?.name ?? strings.templateClassic;
}

/** The page's own colour and photos, and what changes them (spec 0060); absent, the panel draws names alone. */
export interface DesignExtras extends PhotoExtras {
  /** What an accent pair draws as, for the picker's note (AC-6). */
  readonly colours: (accent?: string, accentDark?: string) => BrandColours | undefined;
  /** The page's variables as the preview holds them, so every tile shows the owner's colour and photos. */
  readonly variables: readonly (readonly [string, string])[];
  readonly quickPicks: readonly AccentQuickPick[];
  /** A colour picked (undefined follows the workspace), with its dark one; shown at once, then saved. */
  readonly onAccent: (accent: string | undefined, accentDark: string | undefined) => void;
  /** The colour under the system picker's pointer, before it settles. */
  readonly onPreviewAccent: (accent: string) => void;
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
 * Profile photo shape, then the background photo as one row saying in a line where it shows. A page with no template
 * of its own wears its workspace's, and the picker says so in three words. A page moved to a template says so once, with Keep it.
 */
export function AppearanceCard({ theme, onChange, refusal, extras, profile }: AppearanceCardProps) {
  const variables = extras?.variables ?? [];
  const look = extras?.look;
  const workspaceTemplate = look?.workspaceTemplate ?? 'classic';
  const worn = theme.template ?? workspaceTemplate;
  const colours = extras?.colours(look?.accent, look?.accentDark);
  const coverSrc = photoSrcOf(extras, 'cover');
  const avatarSrc = photoSrcOf(extras, 'avatar');
  const groundSrc = photoSrcOf(extras, 'ground');
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
        {/* The profile photo's shape stays with the look; the photo itself, and the cover, are in Profile at the top
            (owner, 10 Nov 2026). */}
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
        {/* The background, behind every template. */}
        <PagePhotos slots={['ground']} extras={extras} />
      </SettingsStack>
    </Card>
  );
}
