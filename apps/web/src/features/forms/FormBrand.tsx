// Brief
// Purpose: the form's look (spec 0063, AC-6327): Brand, Mode and Corners on the editor's Appearance tab (T21, 5 November
// 2026: the look of a page in a tab of its own, as the booking page's editor has), beside the preview they change, and
// the preview wearing the workspace's kit, from the same colours the hosted page's stylesheet holds.
// Main task: change the look and see the form take it at once, before publishing.
// Leaves out: editing the kit (its logo and colour), which is Settings › Brand, one press away.
import type { BrandKit, BrandStore, FormDocument, PublicForm } from '@crm/data';
import { useBrand } from '@crm/data/react';
import {
  Card,
  HostedFormPreview,
  SegmentedControl,
  SettingsRow,
  SettingsStack,
  type HostedFormPreviewProps,
  type PageBrand,
  type PreviewTextChange,
} from '@crm/ui';
import { BrandCard } from '../captures/BrandCard.tsx';
import { strings } from './strings.ts';

/** The kit as the picker and the preview read it, or undefined while it loads. One held per workspace, so the
 * picker and the preview read the same snapshot and the kit is read once. */
function useKit(brand: BrandStore, slug: string): BrandKit | undefined {
  const state = useBrand(brand.kit(slug));
  return state.status === 'ready' ? state.value : undefined;
}

/** A form's look, as the controls over the preview change it. */
export type FormLook = FormDocument['look'];

/** Props for the Appearance tab's look. */
export interface FormAppearanceProps {
  readonly look: FormLook;
  readonly isReadOnly: boolean;
  readonly onChange: (look: FormLook) => void;
  /** The brand store the route loaded; absent when it couldn't load, and the Brand card says so. */
  readonly brand?: BrandStore;
  readonly slug: string;
  /** Settings › Brand, where the workspace's logo and colour are edited. */
  readonly brandHref: string;
}

/**
 * The Appearance tab (T21): Look (Mode and Corners, compact SegmentedControls, as the booking page's Opens in), then
 * the Brand card both editors share (`BrandCard`): whether the form wears the workspace's logo and colour (Workspace
 * brand or Plain), then the kit itself, read only, with Edit brand for whoever may change it.
 */
export function FormAppearance({ look, isReadOnly, onChange, brand, slug, brandHref }: FormAppearanceProps) {
  return (
    <SettingsStack width="readable" rows="inline">
      <Card title={strings.appearanceTitle}>
        <SettingsRow title={strings.colour}>
          <SegmentedControl
            label={strings.colour}
            size="compact"
            isReadOnly={isReadOnly}
            segments={[
              { value: 'light', label: strings.light, icon: 'sun' },
              { value: 'dark', label: strings.dark, icon: 'moon' },
            ]}
            value={look.colour}
            onChange={(colour) => {
              if (colour === 'light' || colour === 'dark') onChange({ ...look, colour });
            }}
          />
        </SettingsRow>
        <SettingsRow title={strings.corners}>
          <SegmentedControl
            label={strings.corners}
            size="compact"
            isReadOnly={isReadOnly}
            segments={[
              { value: 'rounded', label: strings.rounded },
              { value: 'square', label: strings.square },
            ]}
            value={look.corners}
            onChange={(corners) => {
              if (corners === 'rounded' || corners === 'square') onChange({ ...look, corners });
            }}
          />
        </SettingsRow>
      </Card>
      <BrandCard store={brand} failed={brand === undefined} slug={slug} brandHref={brandHref}>
        <SettingsRow title={strings.themeWear}>
          <SegmentedControl
            label={strings.themeWear}
            size="compact"
            isReadOnly={isReadOnly}
            segments={[
              { value: 'brand', label: strings.themeBrand, icon: 'palette' },
              { value: 'plain', label: strings.themePlain },
            ]}
            value={look.theme ?? 'plain'}
            onChange={(theme) => {
              if (theme === 'brand' || theme === 'plain') onChange({ ...look, theme });
            }}
          />
        </SettingsRow>
      </BrandCard>
    </SettingsStack>
  );
}

/** Props for the branded preview. */
export interface BrandedFormPreviewProps {
  /** The brand store the route loaded; the kit is read once and held. */
  readonly brand: BrandStore;
  readonly slug: string;
  readonly form: PublicForm;
  /** With Steps or One at a time, the step or question the preview shows (from 0). */
  readonly step?: number;
  /** `preview` (the default) is the editor's inert column; `page` is the draft opened in a tab to try. */
  readonly mode?: 'preview' | 'page';
  /** The headline and the button, edited where they are (T21). */
  readonly onTextChange?: (change: PreviewTextChange) => void;
  /** The thank-you message being edited, drawn in the form's place (HostedFormPreview's `ending`). */
  readonly ending?: HostedFormPreviewProps['ending'];
}

/**
 * The preview wearing the workspace's kit. While the kit loads, or where the workspace has none, it draws the
 * product's own accent, which is what the hosted page draws too, so the two never disagree.
 */
export function BrandedFormPreview({ brand, slug, form, step, mode, onTextChange, ending }: BrandedFormPreviewProps) {
  const kit = useKit(brand, slug);
  const colours = brand.colours(kit?.accent, kit?.accentDark);
  const logoSrc = kit?.logo === undefined ? undefined : brand.logoSrc(slug, kit.logo.version);
  const wearing: PageBrand = {
    ...(logoSrc === undefined ? {} : { logo: { src: logoSrc, alt: strings.brandLogoAlt } }),
    ...(colours === undefined ? {} : { variables: colours.variables }),
  };
  return (
    <HostedFormPreview
      form={form}
      brand={wearing}
      {...(step === undefined ? {} : { step })}
      {...(mode === undefined ? {} : { mode })}
      {...(onTextChange === undefined ? {} : { onTextChange })}
      {...(ending === undefined ? {} : { ending })}
    />
  );
}
