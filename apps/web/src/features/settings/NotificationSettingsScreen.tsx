// Brief
// Purpose: Settings › Account › Notifications (spec 0038): what reaches this person by email from this workspace.
// Main task: turn each kind of email, and the daily digest, on or off; each switch saves at once.
// Leaves out: the in app inbox (always on), other workspaces' settings, push notifications.
import type { InboxSettings, NotificationSettingsChange } from '@crm/data';
import { useNotificationSettings } from '@crm/data/react';
import { Badge, Card, EmptyState, Skeleton, SettingsRow, SettingsSection, Switch } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { strings } from './notifications-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** The email switches, in order: each kind, by its setting. */
const KINDS = [
  { key: 'emailMentions', title: strings.mentions, description: strings.mentionsDescription },
  { key: 'emailReplies', title: strings.replies, description: strings.repliesDescription },
  { key: 'emailAssignments', title: strings.assignments, description: strings.assignmentsDescription },
] as const;

/** The page's sections while the settings load: the email card, busy. */
export function NotificationSettingsLoading() {
  return (
    <SettingsSection title={strings.email} description={strings.emailDescription}>
      <Card isBusy>
        <Skeleton width="long" />
        <Skeleton width="medium" />
      </Card>
    </SettingsSection>
  );
}

/** Props for the Notifications page. */
export interface NotificationSettingsScreenProps {
  readonly slug: string;
  readonly settings: InboxSettings;
}

/**
 * Settings › Account › Notifications (AC-1179): the inbox, always on; a switch
 * per kind of email; the daily digest. Each switch saves at once through the
 * data layer and is put back with a toast on a refusal; a change in another tab
 * shows here live (AC-1180).
 */
export function NotificationSettingsScreen({ slug, settings }: NotificationSettingsScreenProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const state = useNotificationSettings(settings);
  const save = (change: NotificationSettingsChange) => {
    void data.inbox.setSettings(slug, change);
  };

  let email;
  if (state.status === 'error') {
    email = (
      <EmptyState tone="error" title={strings.loadFailed} onRetry={settings.retry}>
        {state.error?.message}
      </EmptyState>
    );
  } else if (state.settings === undefined) {
    email = <NotificationSettingsLoading />;
  } else {
    const shown = state.settings;
    email = (
      <SettingsSection title={strings.email} description={strings.emailDescription}>
        <Card>
          {KINDS.map((kind) => (
            <SettingsRow key={kind.key} title={kind.title} description={kind.description}>
              <Switch
                label={kind.title}
                isLabelHidden
                isSelected={shown[kind.key]}
                onChange={(isSelected) => {
                  save({ [kind.key]: isSelected });
                }}
              />
            </SettingsRow>
          ))}
          <SettingsRow title={strings.digest} description={strings.digestDescription}>
            <Switch
              label={strings.digest}
              isLabelHidden
              isSelected={shown.digest}
              onChange={(isSelected) => {
                // The digest comes at 8 in the morning in the time zone this browser has now.
                save(
                  isSelected
                    ? { digest: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
                    : { digest: false },
                );
              }}
            />
          </SettingsRow>
        </Card>
      </SettingsSection>
    );
  }

  return (
    <SettingsPage title={strings.title} description={strings.description}>
      <SettingsSection title={strings.inbox}>
        <Card>
          <SettingsRow title={strings.inboxRow} description={strings.inboxRowDescription}>
            <Badge text={strings.inboxAlways} />
          </SettingsRow>
        </Card>
      </SettingsSection>
      {email}
    </SettingsPage>
  );
}
