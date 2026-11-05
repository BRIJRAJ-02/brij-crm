// Brief
// Purpose: a booking page's Appearance tab (T21, 5 November 2026: the look of a page in a tab of its own, as a form's
// editor has it): how the page opens (Month, List or Chat), and the brand it wears, which is the workspace's logo and
// colour (Settings › Brand: Logo, Colour, Template), shown as they are with one way to change them.
// Main task: pick how the page opens and see it in the phone beside; see the brand the page wears, and go and change it.
// Leaves out: editing the brand here (one kit for every booking page and form, kept in Settings › Brand), and a look
// of the page's own (a booking page wears the workspace's template; only a link page picks its own).
import type { BrandStore, DataLayer } from '@crm/data';
import { Card, SegmentedControl, SettingsRow, SettingsStack } from '@crm/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { BrandCard } from '../captures/BrandCard.tsx';
import { strings } from './strings.ts';

/** How the page opens: its month, its list of times, or its chat. */
export type PageOpensIn = 'month' | 'list' | 'chat';

/** Props for PageAppearance. */
export interface PageAppearanceProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly opensIn: PageOpensIn;
  /** The page's parts its workspace sets (a managed page's): its look can't change here. */
  readonly isLocked: boolean;
  readonly onOpensIn: (next: PageOpensIn) => void;
  /** Settings › Brand, where the logo, colour and template are edited. */
  readonly brandHref: string;
  /** The help beside Opens in (the editor's InfoTip). */
  readonly opensInMeta?: ReactNode;
}

/** The Appearance tab: Layout (Opens in), then Brand (logo, colour and template, as the page wears them). */
export function PageAppearance({
  data,
  slug,
  opensIn,
  isLocked,
  onOpensIn,
  brandHref,
  opensInMeta,
}: PageAppearanceProps) {
  // The brand store is its own chunk, loaded when this tab first opens (as Settings › Brand loads it).
  const [store, setStore] = useState<BrandStore | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // Try again after a failed load reads it once more.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isLive = true;
    data.brand.load().then(
      (made) => {
        if (isLive) setStore(made);
      },
      () => {
        if (isLive) setFailed(true);
      },
    );
    return () => {
      isLive = false;
    };
  }, [data, attempt]);
  return (
    <SettingsStack width="readable" rows="inline">
      <Card title={strings.layoutSection}>
        {/* The view the page opens in (the owner, 25 Oct 2026): the host's default, which a visitor's own remembered
            choice still wins over; the phone beside this switches to it at once. */}
        <SettingsRow title={strings.opensIn} {...(opensInMeta === undefined ? {} : { meta: opensInMeta })}>
          <SegmentedControl
            label={strings.opensIn}
            size="compact"
            segments={[
              { value: 'month', label: strings.opensInViews.month },
              { value: 'list', label: strings.opensInViews.list },
              { value: 'chat', label: strings.opensInViews.chat },
            ]}
            value={opensIn}
            isReadOnly={isLocked}
            onChange={(value) => {
              if (value === 'month' || value === 'list' || value === 'chat') onOpensIn(value);
            }}
          />
        </SettingsRow>
      </Card>
      <BrandCard
        store={store}
        failed={failed}
        onRetry={() => {
          setFailed(false);
          setAttempt((before) => before + 1);
        }}
        slug={slug}
        brandHref={brandHref}
      />
    </SettingsStack>
  );
}
