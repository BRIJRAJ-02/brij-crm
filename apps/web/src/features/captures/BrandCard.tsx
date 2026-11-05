// Brief
// Purpose: the Brand card both Captures editors' Appearance tabs share (T21, 5 November 2026): the workspace's logo,
// colour and template as a booking page or a form wears them, read through the brand store as Settings › Brand reads
// them, so the three never disagree.
// Main task: see the brand the page wears, and go to Settings › Brand to change it (Edit brand, for whoever may).
// Leaves out: editing the kit here (one kit for every booking page and form), and a form's choice to wear it or not
// (the form's own row, passed in as `children`, first in the card).
import type { BrandStore } from '@crm/data';
import { useBrand } from '@crm/data/react';
import { AccentPicker, ButtonLink, Card, EmptyState, FileDrop, SettingsRow, Skeleton } from '@crm/ui';
import type { ReactNode } from 'react';
import { strings as brandStrings } from '../settings/brand-strings.ts';
import { strings } from './strings.ts';

/** The template names, as Settings › Brand words them. */
const TEMPLATE_NAMES = {
  classic: brandStrings.templateClassic,
  studio: brandStrings.templateStudio,
  night: brandStrings.templateNight,
  split: brandStrings.templateSplit,
} as const;

/** Props for BrandCard. */
export interface BrandCardProps {
  /** The brand store, once loaded; undefined while it loads. */
  readonly store: BrandStore | undefined;
  /** The store couldn't load: the card says so, with Try again. */
  readonly failed?: boolean;
  readonly onRetry?: () => void;
  readonly slug: string;
  /** Settings › Brand. */
  readonly brandHref: string;
  /** Rows of the editor's own before the kit's (a form's Logo and colour: Workspace brand or Plain). */
  readonly children?: ReactNode;
}

/** The Brand card: the editor's own rows, then the kit's Logo, Colour and Template, read only, with Edit brand. */
export function BrandCard({ store, failed = false, onRetry, slug, brandHref, children }: BrandCardProps) {
  if (failed) {
    return (
      <Card title={strings.brandTitle}>
        <EmptyState tone="error" title={strings.brandFailed} {...(onRetry === undefined ? {} : { onRetry })} />
      </Card>
    );
  }
  if (store === undefined) {
    return (
      <Card title={strings.brandTitle} isBusy>
        {children}
        <SettingsRow title={brandStrings.logo} control="field">
          <Skeleton shape="field" />
        </SettingsRow>
      </Card>
    );
  }
  return (
    <KitCard store={store} slug={slug} brandHref={brandHref}>
      {children}
    </KitCard>
  );
}

/** The card with the kit read. */
function KitCard({
  store,
  slug,
  brandHref,
  children,
}: {
  readonly store: BrandStore;
  readonly slug: string;
  readonly brandHref: string;
  readonly children?: ReactNode;
}) {
  const state = useBrand(store.kit(slug));
  const kit = state.status === 'ready' ? state.value : undefined;
  const logoSrc = kit?.logo === undefined ? undefined : store.logoSrc(slug, kit.logo.version);
  return (
    <Card
      title={strings.brandTitle}
      description={strings.brandText}
      // Only for whoever may change the kit (owners and admins): anyone else would land on a read only page.
      {...(kit?.canEdit === true
        ? {
            actions: (
              <ButtonLink variant="ghost" icon="palette" href={brandHref}>
                {strings.editBrand}
              </ButtonLink>
            ),
          }
        : {})}
    >
      {children}
      <SettingsRow title={brandStrings.logo} control="field">
        {kit === undefined ? (
          <Skeleton shape="field" />
        ) : logoSrc === undefined ? (
          brandStrings.noLogo
        ) : (
          <FileDrop
            label={brandStrings.logo}
            isReadOnly
            preview={{ src: logoSrc, alt: brandStrings.logoAlt }}
            onFiles={() => undefined}
          />
        )}
      </SettingsRow>
      <SettingsRow title={brandStrings.colour} control="field">
        {kit === undefined ? (
          <Skeleton shape="field" />
        ) : (
          <AccentPicker
            label={brandStrings.colour}
            isLabelHidden
            defaultName={brandStrings.colourDefault}
            {...(kit.accent === undefined ? {} : { value: kit.accent })}
            quickPicks={store.quickPicks}
            isReadOnly
            onChange={() => undefined}
          />
        )}
      </SettingsRow>
      <SettingsRow title={brandStrings.template}>
        {kit === undefined ? <Skeleton shape="text" /> : TEMPLATE_NAMES[kit.template]}
      </SettingsRow>
    </Card>
  );
}
