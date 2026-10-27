// Brief
// Purpose: Settings › Account › Preferences (spec 0026): how the app looks and reads for this person.
// Main task: pick the theme, time zone, date format, week start and start page, and show or hide the setup checklist;
// each applies the moment it changes; open Customise sidebar (spec 0034). The theme is kept on this browser and shows
// at once, so it has no toast; the rest save with a toast and Undo.
// Leaves out: the language (the browser's) and the clock's 12 or 24 hours (both later).
import type { MemberPreferences, ObjectSummary, PreferencesChange, PreferencesState } from '@crm/data';
import {
  Card,
  EmptyState,
  InfoTip,
  Select,
  SettingsRow,
  SettingsSection,
  Skeleton,
  useFormatSettings,
  type Toasts,
} from '@crm/ui';
import { parseThemeChoice, type ThemeChoice, type ThemeController } from '@crm/ui/theme';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { zoneItems, zoneMatches } from '../booking/hours.ts';
import { offsetLabel, zoneName } from '../../public/booking/time.ts';
import { browserZone } from '../booking/zone.ts';
import { dayAt } from '../tasks/day.ts';
import {
  BROWSER_ZONE,
  dateFormatChoices,
  editOf,
  landingChoices,
  landingId,
  stillShows,
  weekStartChoices,
} from './preferences.ts';
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
  /** The member's own preferences in this workspace, through the data layer. */
  readonly preferences: PreferencesState;
  /** The workspace's objects, for the start page's choices. */
  readonly objects: readonly ObjectSummary[];
  /** Sends a change (shown at once, put back with a toast if refused); answers whether it landed. */
  readonly onChange: (change: PreferencesChange) => Promise<boolean>;
  readonly toasts: Toasts;
  /** Reads the preferences again after a failed read. */
  readonly onRetry: () => void;
  /** The way into Customise sidebar (spec 0034): the route hands it in, over the workspace's sidebar. */
  readonly customiseSidebar?: ReactNode;
}

/** Settings › Account › Preferences: Appearance (the theme), Dates and time, the Start page, then the Sidebar. */
export function PreferencesScreen({
  theme,
  preferences,
  objects,
  onChange,
  toasts,
  onRetry,
  customiseSidebar,
}: PreferencesScreenProps) {
  // The controller is the one source: a change here, in another tab or on the status page shows at once.
  const choice = useSyncExternalStore(
    (listener) => theme.subscribe(listener),
    () => theme.get(),
  );
  return (
    <SettingsPage title={strings.title}>
      <SettingsSection title={strings.appearance}>
        <Card>
          <SettingsRow title={strings.theme} description={strings.themeDescription} control="field">
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
      {preferences.status === 'ready' ? (
        <MemberSections preferences={preferences.preferences} objects={objects} onChange={onChange} toasts={toasts} />
      ) : preferences.status === 'loading' ? (
        <Skeleton lines={3} />
      ) : (
        <EmptyState tone="error" title={strings.failed} onRetry={onRetry}>
          {preferences.message}
        </EmptyState>
      )}
      {customiseSidebar !== undefined && (
        <SettingsSection title={strings.sidebar}>
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

/** The member's own preferences: each select and the switch save at once, with a quiet toast whose Undo puts it back. */
function MemberSections({
  preferences,
  objects,
  onChange,
  toasts,
}: {
  readonly preferences: MemberPreferences;
  readonly objects: readonly ObjectSummary[];
  readonly onChange: (change: PreferencesChange) => Promise<boolean>;
  readonly toasts: Toasts;
}) {
  const { locale, timeZone } = useFormatSettings();
  const browser = useMemo(() => browserZone(), []);
  // Automatic (the browser's zone, which follows the device) first; the browser's own place is pinned only once chosen.
  const zones = useMemo(() => {
    const at = new Date();
    const pinned = preferences.timeZone;
    return [
      {
        id: BROWSER_ZONE,
        label: strings.automatic(zoneName(browser)),
        description: offsetLabel(browser, at.getTime()),
      },
      ...zoneItems(pinned ?? browser, at).filter((item) => pinned !== undefined || item.id !== browser),
    ];
  }, [browser, preferences.timeZone]);
  // What the page shows now, for an Undo pressed later: an Undo for an older change does nothing.
  const latest = useRef(preferences);
  useEffect(() => {
    latest.current = preferences;
  }, [preferences]);
  // Today, for the date formats' examples: read once when the page opens.
  const [openedAt] = useState(() => Date.now());
  const today = dayAt(openedAt, timeZone);
  const formats = useMemo(() => dateFormatChoices(today, locale), [today, locale]);
  const weeks = useMemo(() => weekStartChoices(), []);
  const landings = useMemo(() => landingChoices(objects), [objects]);

  // The last "Preferences saved": a newer one replaces it, so several changes leave one toast, not a stack.
  const lastSaved = useRef<string | undefined>(undefined);
  const pick = (field: 'timeZone' | 'dateFormat' | 'weekStart' | 'landing', id: string | null) => {
    if (id === null) return;
    const edit = editOf(preferences, field, id);
    if (edit === undefined) return;
    void onChange(edit.change).then((landed) => {
      if (!landed) return;
      if (lastSaved.current !== undefined) toasts.dismiss(lastSaved.current);
      lastSaved.current = toasts.toast({
        tone: 'success',
        message: strings.saved,
        action: {
          label: strings.undo,
          onAction: () => {
            if (!stillShows(latest.current, edit.change)) return;
            void onChange(edit.undo).then((undone) => {
              if (undone) toasts.toast({ tone: 'success', message: strings.undone });
            });
          },
        },
      });
    });
  };

  return (
    <>
      <SettingsSection title={strings.dates}>
        <Card>
          <SettingsRow
            title={strings.timeZone}
            description={strings.timeZoneDescription}
            meta={<InfoTip label={strings.timeZone}>{strings.timeZoneInfo}</InfoTip>}
            control="field"
          >
            <Select
              label={strings.timeZone}
              isLabelHidden
              items={zones}
              filter={zoneMatches}
              isSearchable
              value={preferences.timeZone ?? BROWSER_ZONE}
              onChange={(id) => pick('timeZone', id)}
            />
          </SettingsRow>
          <SettingsRow title={strings.dateFormat} control="field">
            <Select
              label={strings.dateFormat}
              isLabelHidden
              items={formats}
              value={preferences.dateFormat}
              onChange={(id) => pick('dateFormat', id)}
            />
          </SettingsRow>
          <SettingsRow title={strings.weekStart} control="field">
            <Select
              label={strings.weekStart}
              isLabelHidden
              items={weeks}
              value={preferences.weekStart}
              onChange={(id) => pick('weekStart', id)}
            />
          </SettingsRow>
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.startPage}>
        <Card>
          <SettingsRow title={strings.landing} description={strings.landingDescription} control="field">
            <Select
              label={strings.landing}
              isLabelHidden
              items={landings}
              value={landingId(preferences.landing, objects)}
              onChange={(id) => pick('landing', id)}
            />
          </SettingsRow>
        </Card>
      </SettingsSection>
    </>
  );
}
