// Brief
// Purpose: the form's look where it meets the workspace's brand kit (spec 0063, AC-6327): the Colours picker beside
// the preview, and the preview wearing the kit, from the same colours the hosted page's stylesheet holds (0060, AC-7).
// Main task: pick Brand or Plain and see the form take it at once, before publishing.
// Leaves out: editing the kit, which is Settings › Brand, and the Light/Dark and Corners axes, which need none of it.
import type { BrandKit, BrandStore, PublicForm } from '@crm/data';
import type { FormLookTheme } from '@crm/data/forms';
import { useBrand } from '@crm/data/react';
import { HostedFormPreview, Select, type PageBrand } from '@crm/ui';
import { strings } from './strings.ts';

/** The kit as the picker and the preview read it, or undefined while it loads. One held per workspace, so the
 * picker and the preview read the same snapshot and the kit is read once. */
function useKit(brand: BrandStore, slug: string): BrandKit | undefined {
  const state = useBrand(brand.kit(slug));
  return state.status === 'ready' ? state.value : undefined;
}

/** Props for the Colours picker. */
export interface BrandThemeSelectProps {
  readonly value: FormLookTheme;
  readonly isReadOnly: boolean;
  readonly onChange: (theme: FormLookTheme) => void;
  /** Said under Brand colours: where to put a kit the workspace hasn't saved yet. */
  readonly hint?: string;
}

/**
 * Colours: the workspace's brand kit, or the product's own (AC-6327). A workspace with nothing saved yet is given
 * its `hint`, since Brand would otherwise look like it did nothing.
 */
export function BrandThemeSelect({ value, isReadOnly, onChange, hint }: BrandThemeSelectProps) {
  return (
    <Select
      label={strings.theme}
      isLabelHidden
      size="sm"
      isReadOnly={isReadOnly}
      items={[
        {
          id: 'brand',
          label: strings.themeBrand,
          icon: 'palette',
          ...(hint === undefined ? {} : { description: hint }),
        },
        { id: 'plain', label: strings.themePlain },
      ]}
      value={value}
      onChange={(theme) => {
        if (theme === 'brand' || theme === 'plain') onChange(theme);
      }}
    />
  );
}

/**
 * The picker where the workspace's kit is known (the Form tab): Brand says where to put a kit that is empty. The
 * kit is read through the store, so the picker and the preview never show different states of it.
 */
export function BrandThemeSelectWithKit({
  brand,
  slug,
  ...rest
}: Omit<BrandThemeSelectProps, 'hint'> & { readonly brand: BrandStore; readonly slug: string }) {
  const kit = useKit(brand, slug);
  const isEmpty = kit !== undefined && kit.accent === undefined && kit.logo === undefined;
  return <BrandThemeSelect {...rest} {...(isEmpty ? { hint: strings.themeBrandEmpty } : {})} />;
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
}

/**
 * The preview wearing the workspace's kit. While the kit loads, or where the workspace has none, it draws the
 * product's own accent, which is what the hosted page draws too, so the two never disagree.
 */
export function BrandedFormPreview({ brand, slug, form, step, mode }: BrandedFormPreviewProps) {
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
    />
  );
}
