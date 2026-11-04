// Brief
// Purpose: the form's look (spec 0063, AC-6327): one Design button over the preview holding Colour, Corners and
// Colours, and the preview wearing the workspace's kit, from the same colours the hosted page's stylesheet holds.
// Main task: change the look and see the form take it at once, before publishing.
// Leaves out: editing the kit, which is Settings › Brand.
import type { BrandKit, BrandStore, FormDocument, PublicForm } from '@crm/data';
import { useBrand } from '@crm/data/react';
import {
  Button,
  HostedFormPreview,
  Popover,
  SegmentedControl,
  SettingsRow,
  type HostedFormPreviewProps,
  type PageBrand,
  type PreviewTextChange,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { strings } from './strings.ts';

/** The kit as the picker and the preview read it, or undefined while it loads. One held per workspace, so the
 * picker and the preview read the same snapshot and the kit is read once. */
function useKit(brand: BrandStore, slug: string): BrandKit | undefined {
  const state = useBrand(brand.kit(slug));
  return state.status === 'ready' ? state.value : undefined;
}

/** A form's look, as the Design popover changes it. */
export type FormLook = FormDocument['look'];

/** Props for the Design button. */
export interface DesignButtonProps {
  readonly look: FormLook;
  readonly isReadOnly: boolean;
  readonly onChange: (look: FormLook) => void;
  /** The brand store the route loaded, to say where to add a kit the workspace hasn't saved yet. */
  readonly brand?: BrandStore;
  readonly slug: string;
}

/**
 * Design (5 November 2026: the look's three pickers over the preview read as clutter): one button over the preview
 * opening a small panel with the form's look, each axis a row with its choices side by side: Colour (Light or Dark),
 * Corners (Rounded or Square) and Colours (Workspace brand or Plain, AC-6327). Each change shows on the preview at
 * once and goes live with the next publish.
 */
export function DesignButton({ look, isReadOnly, onChange, brand, slug }: DesignButtonProps) {
  const [isOpen, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={triggerRef} size="sm" icon="palette" onPress={() => setOpen(true)}>
        {strings.design}
      </Button>
      <Popover
        label={strings.design}
        triggerRef={triggerRef}
        isOpen={isOpen}
        onOpenChange={setOpen}
        width="panel"
        placement="bottom end"
      >
        {brand === undefined ? (
          <DesignRows look={look} isReadOnly={isReadOnly} onChange={onChange} />
        ) : (
          <DesignRowsWithKit brand={brand} slug={slug} look={look} isReadOnly={isReadOnly} onChange={onChange} />
        )}
      </Popover>
    </>
  );
}

/** The look's three rows, with the hint under Colours where the workspace has no kit yet. */
function DesignRows({
  look,
  isReadOnly,
  onChange,
  hint,
}: Pick<DesignButtonProps, 'look' | 'isReadOnly' | 'onChange'> & { readonly hint?: string }) {
  return (
    <>
      <SettingsRow title={strings.colour}>
        <SegmentedControl
          label={strings.colour}
          size="compact"
          isFitted
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
          isFitted
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
      <SettingsRow title={strings.theme} {...(hint === undefined ? {} : { description: hint })}>
        <SegmentedControl
          label={strings.theme}
          size="compact"
          isFitted
          isReadOnly={isReadOnly}
          segments={[
            { value: 'brand', label: strings.themeBrand },
            { value: 'plain', label: strings.themePlain },
          ]}
          value={look.theme ?? 'plain'}
          onChange={(theme) => {
            if (theme === 'brand' || theme === 'plain') onChange({ ...look, theme });
          }}
        />
      </SettingsRow>
    </>
  );
}

/**
 * The rows where the workspace's kit is known (the Form tab): Workspace brand says where to put a kit that is
 * empty. The kit is read through the store, so the rows and the preview never show different states of it.
 */
function DesignRowsWithKit({
  brand,
  slug,
  ...rest
}: Pick<DesignButtonProps, 'look' | 'isReadOnly' | 'onChange'> & {
  readonly brand: BrandStore;
  readonly slug: string;
}) {
  const kit = useKit(brand, slug);
  const isEmpty = kit !== undefined && kit.accent === undefined && kit.logo === undefined;
  return <DesignRows {...rest} {...(isEmpty ? { hint: strings.themeBrandEmpty } : {})} />;
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
