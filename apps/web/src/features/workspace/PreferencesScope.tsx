// Brief
// Purpose: every page inside a workspace formats dates in the member's own time zone, date format and week start.
// Main task: none; it wraps the pages and follows Settings › Account › Preferences the moment they change.
// Leaves out: the language (still the browser's) and public pages outside the workspace.
import type { DataLayer } from '@crm/data';
import { usePreferences } from '@crm/data/react';
import { FormatScope } from '@crm/ui';
import type { ReactNode } from 'react';

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
  return (
    <FormatScope
      timeZone={preferences?.timeZone}
      dateFormat={preferences?.dateFormat}
      weekStart={preferences?.weekStart}
    >
      {children}
    </FormatScope>
  );
}
