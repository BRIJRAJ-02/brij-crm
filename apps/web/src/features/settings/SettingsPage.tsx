// Brief
// Purpose: puts one settings page beside the settings sidebar: its trail ("Account › Preferences"), h1, description and body.
// Main task: hand SettingsLayout what the page's route loaded, so every settings page has the same header (AC-683).
// Leaves out: loading anything itself (each settings route's loader read through the data layer), and the sidebar (the settings layout route draws it).
import type { Hue, ObjectIcon } from '@crm/data';
import { EmptyState, Link, SettingsLayout, type Crumb } from '@crm/ui';
import { useLocation, useParams } from '@tanstack/react-router';
import type { ReactNode, Ref } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { objectsSettingsHref, preferencesHref, settingsGroupOf, settingsNav, settingsPageOf } from './nav.ts';
import { strings } from './strings.ts';

/** Props for one settings page. */
export interface SettingsPageProps {
  /** The page's h1 ("Objects", "Projects"), and the last place in its trail. */
  readonly title: string;
  /** Places between the page's group and its title: Objects, on an object's page. */
  readonly crumbs?: readonly Crumb[];
  readonly icon?: ObjectIcon;
  readonly hue?: Hue;
  /** Beside the title: a Standard or Custom badge. */
  readonly meta?: ReactNode;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly isLoading?: boolean;
  /** The visible title, for a page that moves focus to it itself (a cancelled job's Cancel goes away). */
  readonly titleRef?: Ref<HTMLHeadingElement>;
  /** The body opens with Tabs: their underline divides the page in place of the header's hairline. */
  readonly hasTabs?: boolean;
  readonly children: ReactNode;
}

/**
 * A settings page: SettingsLayout with the page's trail (its group, any
 * places between, then its title) over its h1, inside the settings frame.
 */
export function SettingsPage({
  title,
  crumbs = [],
  icon,
  hue,
  meta,
  description,
  actions,
  isLoading = false,
  titleRef,
  hasTabs = false,
  children,
}: SettingsPageProps) {
  const { slug = '' } = useParams({ strict: false });
  const page = useLocation({ select: (location) => settingsPageOf(location.pathname) });
  const group = settingsGroupOf(settingsNav(slug), page);
  const trail: readonly Crumb[] = [
    ...(group === undefined ? [] : [{ id: group.id, label: group.label }]),
    ...crumbs,
    { id: 'current', label: title },
  ];
  return (
    <WorkspacePage
      page={{
        topBar: undefined,
        body: (
          <SettingsLayout
            titleLevel={1}
            trail={trail}
            hasTabs={hasTabs}
            title={title}
            isLoading={isLoading}
            {...(titleRef === undefined ? {} : { titleRef })}
            {...(icon === undefined ? {} : { icon })}
            {...(hue === undefined ? {} : { hue })}
            {...(meta === undefined ? {} : { meta })}
            {...(description === undefined ? {} : { description })}
            {...(actions === undefined ? {} : { actions })}
          >
            {children}
          </SettingsLayout>
        ),
      }}
    />
  );
}

/** The places between a settings page's group and its title: none on Objects, Objects on an object's page. */
export function settingsCrumbs(slug: string, depth: 'objects' | 'object'): readonly Crumb[] {
  return depth === 'objects' ? [] : [{ id: 'objects', label: strings.objects, href: objectsSettingsHref(slug) }];
}

/** A settings address that names nothing (an unknown object or tab): said inside the frame, with the way back. */
export function SettingsMissing({ backTo = 'objects' }: { readonly backTo?: 'objects' | 'home' }) {
  const { slug = '' } = useParams({ strict: false });
  return (
    <SettingsPage title={strings.missingTitle}>
      <EmptyState
        icon="search"
        title={strings.missingText}
        actions={
          <Link href={backTo === 'objects' ? objectsSettingsHref(slug) : preferencesHref(slug)}>
            {strings.backToSettings}
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
