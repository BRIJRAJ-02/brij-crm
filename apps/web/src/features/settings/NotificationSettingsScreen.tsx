// Brief
// Purpose: Settings › Account › Notifications (spec 0038): what reaches this person by email from this workspace.
// Main task: turn each kind of email, and the daily digest, on or off; each switch saves at once, then says so in a
// toast with Undo.
// Leaves out: the in app inbox (always on, said in the Email InfoTip), other workspaces' settings, push notifications.
import type { InboxSettings, NotificationSettings, NotificationSettingsChange } from '@crm/data';
import { useNotificationSettings } from '@crm/data/react';
import { Card, EmptyState, InfoTip, Skeleton, SettingsRow, SettingsSection, Switch } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { strings } from './notifications-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** The email switches, in order: each kind, by its setting, with its InfoTip saying when it comes. */
const KINDS = [
  { key: 'emailMentions', title: strings.mentions, info: strings.mentionsInfo },
  { key: 'emailReplies', title: strings.replies, info: strings.repliesInfo },
  { key: 'emailAssignments', title: strings.assignments, info: strings.assignmentsInfo },
] as const;

/** True while `shown` still has every switch `change` set: an Undo for an older change does nothing. */
export function stillShown(shown: NotificationSettings | undefined, change: NotificationSettingsChange): boolean {
  if (shown === undefined) return false;
  const switches = ['emailMentions', 'emailReplies', 'emailAssignments', 'digest'] as const;
  return switches.every((key) => change[key] === undefined || change[key] === shown[key]);
}

/** The page while the settings load: the Email card, busy. */
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
 * Settings › Account › Notifications (AC-1179): a switch per kind of email and
 * the daily digest, short labels with their help in InfoTips. Each switch saves at once through the
 * data layer: once it lands, "Notifications saved" with Undo; a refusal is put back with the data layer's
 * own toast. A change in another tab shows here live (AC-1180).
 */
export function NotificationSettingsScreen({ slug, settings }: NotificationSettingsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const state = useNotificationSettings(settings);
  // What the page shows now, for an Undo pressed later.
  const latest = useRef(state.settings);
  useEffect(() => {
    latest.current = state.settings;
  }, [state.settings]);
  // The last "Notifications saved": a newer one replaces it, so flipping several switches leaves one toast, not a stack.
  const lastSaved = useRef<string | undefined>(undefined);
  /** Sends `change`; once it lands, the toast whose Undo sends `undo` while the switches still show the change. */
  const save = (change: NotificationSettingsChange, undo: NotificationSettingsChange) => {
    void data.inbox.setSettings(slug, change).then((refused) => {
      if (refused !== undefined) return;
      if (lastSaved.current !== undefined) toasts.dismiss(lastSaved.current);
      lastSaved.current = toasts.toast({
        tone: 'success',
        message: strings.saved,
        action: {
          label: strings.undo,
          onAction: () => {
            if (!stillShown(latest.current, change)) return;
            void data.inbox.setSettings(slug, undo).then((failed) => {
              if (failed === undefined) toasts.toast({ tone: 'success', message: strings.undone });
            });
          },
        },
      });
    });
  };

  let email;
  if (state.status === 'error') {
    email = (
      <SettingsSection title={strings.email}>
        <EmptyState tone="error" title={strings.loadFailed} onRetry={settings.retry}>
          {state.error?.message}
        </EmptyState>
      </SettingsSection>
    );
  } else if (state.settings === undefined) {
    email = <NotificationSettingsLoading />;
  } else {
    const shown = state.settings;
    email = (
      // A section like every other settings page's: the heading above the card, and the inbox's promise said
      // in a line rather than hidden in a tip.
      <SettingsSection
        title={strings.email}
        description={
          <>
            {strings.emailDescription} <InfoTip label={strings.email}>{strings.emailInfo}</InfoTip>
          </>
        }
      >
        <Card>
          {KINDS.map((kind) => (
            <SettingsRow key={kind.key} title={kind.title} meta={<InfoTip label={kind.title}>{kind.info}</InfoTip>}>
              <Switch
                label={kind.title}
                isLabelHidden
                isSelected={shown[kind.key]}
                onChange={(isSelected) => {
                  save({ [kind.key]: isSelected }, { [kind.key]: !isSelected });
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
                // The digest comes at 8 in the morning in the time zone this browser has now. Undo after turning it
                // off puts it back on in the zone it had.
                const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                save(
                  isSelected ? { digest: true, timeZone: zone } : { digest: false },
                  isSelected ? { digest: false } : { digest: true, timeZone: shown.timeZone ?? zone },
                );
              }}
            />
          </SettingsRow>
        </Card>
      </SettingsSection>
    );
  }

  return <SettingsPage title={strings.title}>{email}</SettingsPage>;
}
