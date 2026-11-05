// Brief
// Purpose: the form's look (spec 0063, AC-6327): Mode, Corners and Brand over the preview, in view without a click
// (forms fixes 3, the owner: "this upfront as it was earlier was better"), and the preview wearing the workspace's kit,
// from the same colours the hosted page's stylesheet holds.
// Main task: change the look and see the form take it at once, before publishing.
// Leaves out: editing the kit, which is Settings › Brand.
import type { BrandKit, BrandStore, FormDocument, PublicForm } from '@crm/data';
import { useBrand } from '@crm/data/react';
import {
  HostedFormPreview,
  Select,
  type HostedFormPreviewProps,
  type PageBrand,
  type PreviewTextChange,
} from '@crm/ui';
import { strings } from './strings.ts';

/** The kit as the picker and the preview read it, or undefined while it loads. One held per workspace, so the
 * picker and the preview read the same snapshot and the kit is read once. */
function useKit(brand: BrandStore, slug: string): BrandKit | undefined {
  const state = useBrand(brand.kit(slug));
  return state.status === 'ready' ? state.value : undefined;
}

/** A form's look, as the controls over the preview change it. */
export type FormLook = FormDocument['look'];

/** Props for the look's controls. */
export interface LookControlsProps {
  readonly look: FormLook;
  readonly isReadOnly: boolean;
  readonly onChange: (look: FormLook) => void;
  /** The brand store the route loaded, to say where to add a kit the workspace hasn't saved yet. */
  readonly brand?: BrandStore;
  readonly slug: string;
}

/**
 * The look, over the preview it changes (forms fixes 3: builder2's Design popover hid it behind a click, and its Brand
 * row wrapped under its label): three compact Selects of one height, side by side in the preview's head, each named
 * for its axis: Mode (Light or Dark), Corners (Rounded or Square) and Brand (Workspace brand or Plain, AC-6327). Each
 * change shows on the preview at once and goes live with the next publish.
 */
export function LookControls({ brand, slug, ...rest }: LookControlsProps) {
  return brand === undefined ? <LookSelects {...rest} /> : <LookSelectsWithKit brand={brand} slug={slug} {...rest} />;
}

/** The three Selects, with where to add a kit under Workspace brand while the workspace has none. */
function LookSelects({
  look,
  isReadOnly,
  onChange,
  hint,
}: Pick<LookControlsProps, 'look' | 'isReadOnly' | 'onChange'> & { readonly hint?: string }) {
  return (
    <>
      <Select
        label={strings.colour}
        isLabelHidden
        size="sm"
        isReadOnly={isReadOnly}
        items={[
          { id: 'light', label: strings.light, icon: 'sun' },
          { id: 'dark', label: strings.dark, icon: 'moon' },
        ]}
        value={look.colour}
        onChange={(colour) => {
          if (colour === 'light' || colour === 'dark') onChange({ ...look, colour });
        }}
      />
      <Select
        label={strings.corners}
        isLabelHidden
        size="sm"
        isReadOnly={isReadOnly}
        items={[
          { id: 'rounded', label: strings.rounded },
          { id: 'square', label: strings.square },
        ]}
        value={look.corners}
        onChange={(corners) => {
          if (corners === 'rounded' || corners === 'square') onChange({ ...look, corners });
        }}
      />
      <Select
        label={strings.theme}
        isLabelHidden
        size="sm"
        isReadOnly={isReadOnly}
        // Where to add a kit, in view while Workspace brand is picked and there is none to wear.
        {...(hint === undefined || look.theme !== 'brand' ? {} : { hint })}
        items={[
          {
            id: 'brand',
            label: strings.themeBrand,
            icon: 'palette',
            ...(hint === undefined ? {} : { description: hint }),
          },
          { id: 'plain', label: strings.themePlain },
        ]}
        value={look.theme ?? 'plain'}
        onChange={(theme) => {
          if (theme === 'brand' || theme === 'plain') onChange({ ...look, theme });
        }}
      />
    </>
  );
}

/**
 * The Selects where the workspace's kit is known (the Form tab): Workspace brand says where to put a kit that is
 * empty. The kit is read through the store, so the Selects and the preview never show different states of it.
 */
function LookSelectsWithKit({
  brand,
  slug,
  ...rest
}: Pick<LookControlsProps, 'look' | 'isReadOnly' | 'onChange'> & {
  readonly brand: BrandStore;
  readonly slug: string;
}) {
  const kit = useKit(brand, slug);
  const isEmpty = kit !== undefined && kit.accent === undefined && kit.logo === undefined;
  return <LookSelects {...rest} {...(isEmpty ? { hint: strings.themeBrandEmpty } : {})} />;
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
