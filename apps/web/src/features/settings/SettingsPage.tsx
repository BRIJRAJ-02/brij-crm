// Brief
// Purpose: puts one settings page beside the settings sidebar: its trail ("Account › Preferences"), h1 and primary action in the bar, then its body.
// Main task: hand SettingsLayout what the page's route loaded, so every settings page has the same header (AC-683).
// Leaves out: loading anything itself (each settings route's loader read through the data layer), and the sidebar (the settings layout route draws it).
import type { Hue, ObjectIcon } from '@crm/data';
import { EmptyState, Link, SettingsLayout, TopBar, type Crumb } from '@crm/ui';
import { useLocation, useParams } from '@tanstack/react-router';
import type { ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { objectsSettingsHref, preferencesHref, settingsGroupOf, settingsNav, settingsPageOf } from './nav.ts';
import { strings } from './strings.ts';
import { useSettingsTopBarSlot } from './topBarSlot.ts';

/** What every settings page takes, whatever its body's shape. */
interface SettingsPageBase {
  /** The page's h1 ("Objects", "Projects"), and the last place in its trail. */
  readonly title: string;
  /** Places between the page's group and its title: Objects, on an object's page. */
  readonly crumbs?: readonly Crumb[];
  readonly icon?: ObjectIcon;
  readonly hue?: Hue;
  /** Beside the title: a Standard or Custom badge. */
  readonly meta?: ReactNode;
  /** The page's one primary action, at the bar's end ("New object", "Connect Google calendar"). */
  readonly actions?: ReactNode;
  /** The visible title, for a page that moves focus to it itself (a cancelled job's Cancel goes away). */
  readonly titleRef?: Ref<HTMLHeadingElement>;
  /**
   * The page is drawn inside a frame somebody else owns: a tab of Bookings rather than a page of Settings (25
   * October 2026). Then it is the body alone, with no second WorkspacePage and no TopBar of its own, since the
   * frame around it has both already. A screen that is both a setting and a tab passes this through rather than
   * being written twice, so Round robin and Calendars look and behave the same wherever they are opened.
   */
  readonly inFrame?: boolean;
  readonly children: ReactNode;
}

/** A page in the settings column (SettingsLayout): most of them. */
interface ColumnSettingsPageProps extends SettingsPageBase {
  readonly isLoading?: boolean;
  /** While loading: a tile's place before the title, for a page that will have one (an object's). */
  readonly hasTile?: boolean;
  /** The body opens with Tabs: their underline divides the page in place of the header's hairline. */
  readonly hasTabs?: boolean;
  /** At the view's foot: the library SaveBar, for a page that saves its changes with one Save. */
  readonly footer?: ReactNode;
  readonly fillsView?: false;
}

/**
 * The body is a grid that fills the view and scrolls itself (Trash): it sits straight under the bar, edge to
 * edge, with no settings column around it, as a records table does. SettingsLayout is skipped, so the props only
 * it reads (loading, tabs, a footer) can't be given: the body draws its own loading rows.
 */
interface FillSettingsPageProps extends SettingsPageBase {
  readonly fillsView: true;
  readonly isLoading?: never;
  readonly hasTile?: never;
  readonly hasTabs?: never;
  readonly footer?: never;
}

/** Props for one settings page: in the settings column, or (`fillsView`) a grid that fills the view. */
export type SettingsPageProps = ColumnSettingsPageProps | FillSettingsPageProps;

/**
 * A settings page: a TopBar with the page's trail (Settings, its group, any
 * places between, then its title; the bar holds the page's h1) in the frame's
 * bar slot, as every page's TopBar sits, with an object's tile and badge and
 * the page's one primary action at its end, and SettingsLayout below it with
 * the body alone: no title block repeats the trail (21 October 2026).
 */
export function SettingsPage({
  title,
  crumbs = [],
  icon,
  hue,
  meta,
  actions,
  isLoading = false,
  hasTile = false,
  titleRef,
  hasTabs = false,
  footer,
  fillsView = false,
  inFrame = false,
  children,
}: SettingsPageProps) {
  const { slug = '' } = useParams({ strict: false });
  const page = useLocation({ select: (location) => settingsPageOf(location.pathname) });
  const group = settingsGroupOf(settingsNav(slug), page);
  // Settings heads the trail, so the page says where it is even on a phone, where the sidebar is a rail of icons.
  // TopBar ends it with the title, as the current place.
  const trail: readonly Crumb[] = [
    { id: 'settings', label: strings.settings },
    ...(group === undefined ? [] : [{ id: group.id, label: group.label }]),
    ...crumbs,
  ];
  const slot = useSettingsTopBarSlot();
  // Inside somebody else's frame the body is the whole of it. `header="bar"` is already the layout with no header
  // of its own, which is exactly what a tab under a TopBar and a tab strip wants.
  if (inFrame) {
    if (fillsView) return children;
    return (
      <SettingsLayout
        header="bar"
        hasTabs={hasTabs}
        title={title}
        isLoading={isLoading}
        hasTile={hasTile}
        footer={footer}
      >
        {children}
      </SettingsLayout>
    );
  }
  return (
    <WorkspacePage
      page={{
        topBar: undefined,
        body: (
          <>
            {slot !== null &&
              createPortal(
                // The bar is the page's header (the owner, 21 October 2026): the trail on the left, with an
                // object's tile and badge, and the page's one primary action on the right, where People's
                // "New person" sits. No title block repeats them under it.
                <TopBar
                  title={title}
                  crumbs={trail}
                  // An object's page loads with its tile still unknown: the bar's skeleton holds the trail's place.
                  isLoading={isLoading && hasTile}
                  {...(titleRef === undefined ? {} : { titleRef })}
                  {...(icon === undefined ? {} : { icon })}
                  {...(hue === undefined ? {} : { hue })}
                  {...(meta === undefined ? {} : { meta })}
                >
                  {actions}
                </TopBar>,
                slot,
              )}
            {fillsView ? (
              // The view is a column: the body's bars take their height, and the grid the rest of it.
              children
            ) : (
              <SettingsLayout
                header="bar"
                hasTabs={hasTabs}
                title={title}
                isLoading={isLoading}
                hasTile={hasTile}
                footer={footer}
              >
                {children}
              </SettingsLayout>
            )}
          </>
        ),
      }}
    />
  );
}

/** The places between a settings page's group and its title on an object's page: Objects. */
export function settingsCrumbs(slug: string): readonly Crumb[] {
  return [{ id: 'objects', label: strings.objects, href: objectsSettingsHref(slug) }];
}

/**
 * A settings address that names nothing: an unknown object or tab (the way
 * back is Objects, under its trail), or any other address in Settings (the
 * way back is where Settings opens).
 */
export function SettingsMissing({ backTo = 'objects' }: { readonly backTo?: 'objects' | 'home' }) {
  const { slug = '' } = useParams({ strict: false });
  const isObject = backTo === 'objects';
  return (
    <SettingsPage title={strings.missingTitle} {...(isObject ? { crumbs: settingsCrumbs(slug) } : {})}>
      <EmptyState
        icon="search"
        title={strings.missingText}
        actions={
          <Link href={isObject ? objectsSettingsHref(slug) : preferencesHref(slug)}>
            {isObject ? strings.backToObjects : strings.backToSettings}
          </Link>
        }
      >
        {strings.checkAddress}
      </EmptyState>
    </SettingsPage>
  );
}

/** A settings page whose read failed: the frame and navigation stay, the body says so with Retry (AC-247). */
export function SettingsFailed({
  title,
  heading,
  text,
  onRetry,
}: {
  /** The page's title ("Objects"). */
  readonly title: string;
  /** What failed ("Couldn't load the objects"). */
  readonly heading: string;
  /** Why, in the data layer's words ("Can't reach the CRM" only when the network failed). */
  readonly text: string;
  readonly onRetry: () => void;
}) {
  return (
    <SettingsPage title={title}>
      <EmptyState tone="error" title={heading} onRetry={onRetry}>
        {text}
      </EmptyState>
    </SettingsPage>
  );
}
