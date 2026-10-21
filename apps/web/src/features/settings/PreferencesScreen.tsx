// Brief
// Purpose: Settings › Account › Preferences (spec 0026): how the app looks for this person.
// Main task: pick the interface theme (System preference, Light or Dark), applied the moment it changes; open Customise sidebar (spec 0034).
// Leaves out: time format, start of week, language and time zone (they need a stored per member preference, a later spec).
import { Card, Select, SettingsRow, SettingsSection } from '@crm/ui';
import { parseThemeChoice, type ThemeChoice, type ThemeController } from '@crm/ui/theme';
import { useSyncExternalStore, type ReactNode } from 'react';
import { strings } from './preferences-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** The theme's choices, System first (the default). */
const THEMES = [
  { id: 'system', label: strings.system, icon: 'monitor' },
  { id: 'light', label: strings.light, icon: 'sun' },
  { id: 'dark', label: strings.dark, icon: 'moon' },
] as const satisfies readonly { readonly id: ThemeChoice; readonly label: string; readonly icon: string }[];

/** Props for the Preferences page. */
export interface PreferencesScreenProps {
  /** The app's theme controller (router context): it keeps the choice in this browser and applies it at once. */
  readonly theme: ThemeController;
  /** The way into Customise sidebar (spec 0034): the route hands it in, over the workspace's sidebar. */
  readonly customiseSidebar?: ReactNode;
}

/** Settings › Account › Preferences: Appearance (the Interface theme, AC-684), then the Sidebar's way into Customise sidebar. */
export function PreferencesScreen({ theme, customiseSidebar }: PreferencesScreenProps) {
  // The controller is the one source: a change here, in another tab or on the status page shows at once.
  const choice = useSyncExternalStore(
    (listener) => theme.subscribe(listener),
    () => theme.get(),
  );
  return (
    <SettingsPage title={strings.title} description={strings.description}>
      <SettingsSection title={strings.appearance} description={strings.appearanceDescription}>
        <Card>
          <SettingsRow title={strings.theme} description={strings.themeDescription}>
            <Select
              label={strings.theme}
              isLabelHidden
              items={THEMES}
              value={choice}
              onChange={(next) => {
                // Never cleared (no isClearable); anything unknown is System.
                theme.set(parseThemeChoice(next));
              }}
            />
          </SettingsRow>
        </Card>
      </SettingsSection>
      {customiseSidebar !== undefined && (
        <SettingsSection title={strings.sidebar} description={strings.sidebarDescription}>
          <Card>
            <SettingsRow title={strings.customise} description={strings.customiseDescription}>
              {customiseSidebar}
            </SettingsRow>
          </Card>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
