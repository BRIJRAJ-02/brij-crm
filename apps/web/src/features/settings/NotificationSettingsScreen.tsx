// Brief
// Purpose: Settings › Account › Notifications (spec 0038): what reaches this person by email from this workspace.
// Main task: turn each kind of email, and the daily digest, on or off; each switch saves at once.
// Leaves out: the in app inbox (always on, said in the Email InfoTip), other workspaces' settings, push notifications.
import type { InboxSettings, NotificationSettingsChange } from '@crm/data';
import { useNotificationSettings } from '@crm/data/react';
import { Card, EmptyState, InfoTip, Skeleton, SettingsRow, Switch } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { strings } from './notifications-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** The email switches, in order: each kind, by its setting. */
const KINDS = [
  { key: 'emailMentions', title: strings.mentions },
  { key: 'emailReplies', title: strings.replies },
  { key: 'emailAssignments', title: strings.assignments },
] as const;

/** The page while the settings load: the Email card, busy. */
export function NotificationSettingsLoading() {
  return (
    <Card title={strings.email} isBusy>
      <Skeleton width="long" />
      <Skeleton width="medium" />
    </Card>
  );
}

/** Props for the Notifications page. */
export interface NotificationSettingsScreenProps {
  readonly slug: string;
  readonly settings: InboxSettings;
}

/**
 * Settings › Account › Notifications (AC-1179): a switch per kind of email and
 * the daily digest, short labels with their help in InfoTips. Each switch saves at once through the
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
      <Card title={strings.email} actions={<InfoTip label={strings.email}>{strings.emailInfo}</InfoTip>}>
        {KINDS.map((kind) => (
          <SettingsRow key={kind.key} title={kind.title}>
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
        <SettingsRow title={strings.digest} meta={<InfoTip label={strings.digest}>{strings.digestInfo}</InfoTip>}>
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
    );
  }

  return <SettingsPage title={strings.title}>{email}</SettingsPage>;
}
