// Brief
// Purpose: puts one settings page inside the workspace frame: the TopBar's trail and h1, then SettingsLayout.
// Main task: hand the frame and the layout what the page's route loaded, so every settings page sits the same way.
// Leaves out: loading anything itself; each settings route's loader read through the data layer.
import type { Hue, ObjectIcon } from '@crm/data';
import { EmptyState, Link, SettingsLayout, TopBar, type Crumb } from '@crm/ui';
import { useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { objectsSettingsHref, settingsNav } from './nav.ts';
import { strings } from './strings.ts';

/** Props for one settings page. */
export interface SettingsPageProps {
  /** The page's h1 in the TopBar, and its heading in the layout ("Objects", "Projects"). */
  readonly title: string;
  /** The trail before the title. */
  readonly crumbs?: readonly Crumb[];
  readonly icon?: ObjectIcon;
  readonly hue?: Hue;
  /** Beside the layout's title: a Standard or Custom badge. */
  readonly meta?: ReactNode;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly isLoading?: boolean;
  readonly children: ReactNode;
}

/** A settings page: the TopBar with its trail, then SettingsLayout with Objects current. */
export function SettingsPage({
  title,
  crumbs,
  icon,
  hue,
  meta,
  description,
  actions,
  isLoading = false,
  children,
}: SettingsPageProps) {
  const { slug = '' } = useParams({ strict: false });
  return (
    <WorkspacePage
      page={{
        topBar: (
          <TopBar
            title={title}
            isLoading={isLoading}
            {...(crumbs === undefined ? {} : { crumbs })}
            {...(icon === undefined ? {} : { icon })}
            {...(hue === undefined ? {} : { hue })}
          />
        ),
        body: (
          <SettingsLayout
            nav={settingsNav(slug)}
            currentNavId="objects"
            navLabel={strings.settings}
            title={title}
            isLoading={isLoading}
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

/** The trail to a settings page: Settings, then Objects on an object's page. */
export function settingsCrumbs(slug: string, depth: 'objects' | 'object'): readonly Crumb[] {
  const settings: Crumb = { id: 'settings', label: strings.settings, href: objectsSettingsHref(slug) };
  return depth === 'objects'
    ? [settings]
    : [settings, { id: 'objects', label: strings.objects, href: objectsSettingsHref(slug) }];
}

/** A settings address that names nothing (an unknown object or tab): said inside the frame, with the way back. */
export function SettingsMissing() {
  const { slug = '' } = useParams({ strict: false });
  return (
    <SettingsPage title={strings.missingTitle} crumbs={settingsCrumbs(slug, 'objects')}>
      <EmptyState
        icon="search"
        title={strings.missingText}
        actions={<Link href={objectsSettingsHref(slug)}>{strings.backToObjects}</Link>}
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
  const { slug = '' } = useParams({ strict: false });
  return (
    <SettingsPage title={title} crumbs={settingsCrumbs(slug, 'objects')}>
      <EmptyState tone="error" title={heading} onRetry={onRetry}>
        {text}
      </EmptyState>
    </SettingsPage>
  );
}
