// Brief
// Purpose: a booking page's Look (the owner's mock of 9 November 2026): its theme, Classic or Night (Studio and Split
// are no longer offered to booking pages; a workspace that picked one reads as Classic), and how the page opens.
// Main task: pick the theme and how the page opens, and see it in the phone beside.
// Leaves out: the logo and colour (Settings › Brand, one kit for every booking page and form, through Edit brand).
// The theme is the workspace's, so a pick goes to every booking page at once, as Settings › Brand's does; how the
// page opens is the page's own and waits for Save changes with the rest.
import { DEFAULT_PAGE_THEME, themeForTemplate, type BrandStore, type DataLayer } from '@crm/data';
import { useBrand } from '@crm/data/react';
import { ButtonLink, Card, EmptyState, LinkPageThumbnail, SegmentedControl, Skeleton, TileGrid } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { strings as capturesStrings } from '../captures/strings.ts';
import { strings as brandStrings } from '../settings/brand-strings.ts';
import { bookingTemplate } from '../../public/booking/template.ts';
import { strings } from './strings.ts';

/** How the page opens: its month, its list of times, or its chat. */
export type PageOpensIn = 'month' | 'list' | 'chat';

/** The two looks a booking page wears. */
const LOOKS = [
  { id: 'classic', name: brandStrings.templateClassic },
  { id: 'night', name: brandStrings.templateNight },
] as const;

/** Props for PageAppearance. */
export interface PageAppearanceProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly opensIn: PageOpensIn;
  /** The page's parts its workspace sets (a managed page's), or a reader who can't change it: read only. */
  readonly isLocked: boolean;
  readonly onOpensIn: (next: PageOpensIn) => void;
  /** Settings › Brand, where the logo and colour are edited. */
  readonly brandHref: string;
}

/** Look: Theme (Classic or Night, with Edit brand), then Opens on. */
export function PageAppearance({ data, slug, opensIn, isLocked, onOpensIn, brandHref }: PageAppearanceProps) {
  // The brand store is its own chunk, loaded when this section first opens (as Settings › Brand loads it).
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
    <>
      {failed ? (
        <Card title={strings.themeSection}>
          <EmptyState
            tone="error"
            title={capturesStrings.brandFailed}
            onRetry={() => {
              setFailed(false);
              setAttempt((before) => before + 1);
            }}
          />
        </Card>
      ) : store === undefined ? (
        <Card title={strings.themeSection} isBusy>
          <Skeleton shape="block" />
        </Card>
      ) : (
        <ThemeCard store={store} slug={slug} brandHref={brandHref} />
      )}
      <Card title={strings.opensIn}>
        {/* The view the page opens in (the owner, 25 Oct 2026): the host's default, which a visitor's own remembered
            choice still wins over; the phone beside this switches to it at once. */}
        <SegmentedControl
          label={strings.opensIn}
          segments={[
            { value: 'month', label: strings.opensInViews.month, icon: 'calendar' },
            { value: 'list', label: strings.opensInViews.list, icon: 'list' },
            { value: 'chat', label: strings.opensInViews.chat, icon: 'message-square' },
          ]}
          value={opensIn}
          isReadOnly={isLocked}
          onChange={(value) => {
            if (value === 'month' || value === 'list' || value === 'chat') onOpensIn(value);
          }}
        />
      </Card>
    </>
  );
}

/** The theme as two pictured choices, the workspace's own one chosen; a pick goes live on every booking page. */
function ThemeCard({
  store,
  slug,
  brandHref,
}: {
  readonly store: BrandStore;
  readonly slug: string;
  readonly brandHref: string;
}) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const state = useBrand(store.kit(slug));
  const kit = state.status === 'ready' ? state.value : undefined;
  const canEdit = kit?.canEdit === true;
  const chosen = bookingTemplate(kit === undefined ? undefined : (kit.templateDraft ?? kit.template)) ?? 'classic';
  const colours = store.colours(kit?.accent, kit?.accentDark);
  const pick = (template: 'classic' | 'night') => {
    void store.saveTemplate(slug, template).then(async (refused) => {
      const failure = refused ?? (await store.publishTemplate(slug));
      toasts.toast(
        failure === undefined
          ? { tone: 'success', message: strings.themeSaved(template === 'night' ? LOOKS[1].name : LOOKS[0].name) }
          : { tone: 'danger', message: failure.message },
      );
    });
  };
  return (
    <Card
      title={strings.themeSection}
      description={strings.themeLine}
      isBusy={kit === undefined}
      {...(canEdit
        ? {
            actions: (
              <ButtonLink variant="ghost" iconRight="arrow-right" href={brandHref}>
                {capturesStrings.editBrand}
              </ButtonLink>
            ),
          }
        : {})}
    >
      {kit === undefined ? (
        <Skeleton shape="block" />
      ) : (
        <TileGrid
          variant="choice"
          label={strings.themeSection}
          keepsPicture
          value={chosen}
          tiles={LOOKS.map((look) => ({
            id: look.id,
            name: look.name,
            isDisabled: !canEdit,
            thumbnail: (
              <LinkPageThumbnail
                theme={themeForTemplate(look.id, DEFAULT_PAGE_THEME)}
                mode="light"
                {...(colours === undefined ? {} : { variables: colours.variables })}
                profile={{ name: brandStrings.sampleHost, rows: [brandStrings.sampleMeeting] }}
              />
            ),
          }))}
          onChange={(picked) => {
            if ((picked === 'classic' || picked === 'night') && picked !== chosen) pick(picked);
          }}
        />
      )}
    </Card>
  );
}
