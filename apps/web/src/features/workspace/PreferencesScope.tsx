// Brief
// Purpose: every page inside a workspace formats dates in the member's own time zone, date format and week start,
// and starts new money and phone fields in the workspace's currency and country.
// Main task: none; it wraps the pages and follows Settings › Account › Preferences and Settings › Workspace › General
// the moment they change.
// Leaves out: the language (still the browser's) and public pages outside the workspace.
import type { DataLayer } from '@crm/data';
import { usePreferences, useWorkspaceRegion } from '@crm/data/react';
import { FormatScope } from '@crm/ui';
import type { ReactNode } from 'react';
import { weekStartOf } from './first-day.ts';

/** Props for PreferencesScope. */
export interface PreferencesScopeProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly children: ReactNode;
}

/** The member's preferences over UiProvider's browser defaults; until they load (or if they fail), the defaults. */
export function PreferencesScope({ data, slug, children }: PreferencesScopeProps) {
  const state = usePreferences(data.preferences.of(slug));
  const preferences = state.status === 'ready' ? state.preferences : undefined;
  // The workspace's own currency and country: read after the page draws, since only a field opened later needs them.
  const region = useWorkspaceRegion(data.workspace.region(slug));
  return (
    <FormatScope
      timeZone={preferences?.timeZone}
      dateFormat={preferences?.dateFormat}
      // Automatic weeks start on Monday, as in round 6; a chosen day wins.
      weekStart={weekStartOf(preferences?.weekStart)}
      currency={region?.currency}
      country={region?.country}
    >
      {children}
    </FormatScope>
  );
}
