// Brief
// Purpose: the one popup that connects a calendar (the owner's mock, 9 November 2026): pick Google or Outlook, finish
// on the provider's own screen, and come back to choose which of the new account's calendars block your times.
// Main task: pick a provider. Leaves out: Apple (a parked proposal), and a "waiting" step: the provider's consent is a
// whole page away, so the popup picks up again when the browser comes back (`?calendar=`).
import {
  type CalendarConnectionView,
  type CalendarItem,
  type CalendarProvider,
  type CalendarStatus,
  type Hue,
} from '@crm/data';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Modal,
  ProviderMark,
  SettingsRow,
  Skeleton,
  Switch,
  type CalloutTone,
} from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings } from './calendar-strings.ts';
import type { ConnectResult } from './connect-result.ts';

/** Where the popup is: choosing a provider, back with a problem, or back with a new account to set up. */
export type ConnectStep =
  | { readonly kind: 'pick' }
  | { readonly kind: 'problem'; readonly result: Exclude<ConnectResult, 'connected'> }
  | { readonly kind: 'choose'; readonly connectionId: string };

/** A provider's mark, its name and which accounts it takes. */
export const PROVIDER = {
  google: { mark: 'google-calendar', name: strings.google, accounts: strings.googleAccounts },
  microsoft: { mark: 'outlook', name: strings.outlook, accounts: strings.outlookAccounts },
} as const satisfies Record<
  CalendarProvider,
  { readonly mark: 'google-calendar' | 'outlook'; readonly name: string; readonly accounts: string }
>;

/** Each state's dot: green when it is up to date, blue while it connects, red once it needs reconnecting. */
export const STATUS_HUE = {
  syncing: 'blue',
  connected: 'green',
  expired: 'red',
  revoked: 'red',
  failed: 'red',
} as const satisfies Record<CalendarStatus, Hue>;

/** Props for ConnectCalendarDialog. */
export interface ConnectCalendarDialogProps {
  /** The step to show; `undefined` closes the popup. */
  readonly step: ConnectStep | undefined;
  /** The providers this deployment offers (Google, Outlook). */
  readonly providers: readonly CalendarProvider[];
  /** Sends the browser to the provider's consent screen. */
  readonly onPick: (provider: CalendarProvider) => void;
  /** The new account, on the choose step, once the page holds it. */
  readonly account: CalendarConnectionView | undefined;
  /** Its calendars, live as its first update lists them; `loading` or `error` while the list isn't there. */
  readonly calendars: readonly CalendarItem[] | 'loading' | 'error';
  /** Switches one of them on or off for conflicts, saved at once. */
  readonly onCheck: (calendar: CalendarItem, isOn: boolean) => void;
  readonly onRetryCalendars: () => void;
  /** Back to the providers, from a problem. */
  readonly onTryAgain: () => void;
  readonly onClose: () => void;
}

/** Each problem's tone: a refusal or a failure warns, the limit and sync off only inform. */
const PROBLEM_TONE = {
  denied: 'warning',
  scope: 'warning',
  failed: 'danger',
  limit: 'info',
  off: 'info',
} as const satisfies Record<Exclude<ConnectResult, 'connected'>, CalloutTone>;

/**
 * Connect a calendar: one popup, one title. Pick a provider (the browser goes to its consent screen); back with a
 * problem, it says what happened with Try again; back with a new account, it lists that account's calendars, each
 * with a switch for whether it blocks your times, and Done.
 */
export function ConnectCalendarDialog({
  step,
  providers,
  onPick,
  account,
  calendars,
  onCheck,
  onRetryCalendars,
  onTryAgain,
  onClose,
}: ConnectCalendarDialogProps) {
  // The last step shown stays drawn through the popup's exit, so its words don't blank as it fades.
  const [shown, setShown] = useState<ConnectStep>({ kind: 'pick' });
  if (step !== undefined && step !== shown) setShown(step);
  // The provider being opened: its button shows busy while the browser leaves for the consent screen.
  const [leavingFor, setLeavingFor] = useState<CalendarProvider | undefined>(undefined);
  // Back from the provider's page with the browser's Back (the page restored as it was left): the buttons wake again.
  useEffect(() => {
    const wake = (event: PageTransitionEvent) => {
      if (event.persisted) setLeavingFor(undefined);
    };
    window.addEventListener('pageshow', wake);
    return () => window.removeEventListener('pageshow', wake);
  }, []);
  const isOpen = step !== undefined;
  const close = (open: boolean) => {
    if (!open) onClose();
  };

  if (shown.kind === 'problem') {
    const problem = strings.problems[shown.result];
    const canRetry = shown.result !== 'limit' && shown.result !== 'off' && providers.length > 0;
    return (
      <Modal
        title={strings.connectTitle}
        isOpen={isOpen}
        onOpenChange={close}
        actions={
          canRetry ? (
            <>
              <Button slot="close">{strings.cancel}</Button>
              <Button variant="primary" onPress={onTryAgain}>
                {strings.tryAgain}
              </Button>
            </>
          ) : (
            <Button slot="close">{strings.close}</Button>
          )
        }
      >
        <Callout tone={PROBLEM_TONE[shown.result]} title={problem.title} isAnnounced>
          {problem.text}
        </Callout>
      </Modal>
    );
  }

  if (shown.kind === 'choose') {
    return (
      <Modal
        title={strings.chooseTitle}
        description={strings.chooseText}
        isOpen={isOpen}
        onOpenChange={close}
        actions={
          <Button variant="primary" onPress={onClose}>
            {strings.done}
          </Button>
        }
      >
        {account !== undefined && (
          <SettingsRow
            title={account.accountEmail}
            leading={<ProviderMark provider={PROVIDER[account.provider].mark} isLabelled />}
            description={<Badge text={strings.status[account.status]} dot={STATUS_HUE[account.status]} />}
          />
        )}
        {calendars === 'loading' ? (
          <span role="status" aria-label={strings.calendarsLoading}>
            <Skeleton width="long" />
          </span>
        ) : calendars === 'error' ? (
          <Callout
            tone="danger"
            actions={
              <Button variant="ghost" onPress={onRetryCalendars}>
                {strings.tryAgain}
              </Button>
            }
          >
            {strings.calendarsFailed}
          </Callout>
        ) : calendars.length === 0 ? (
          <EmptyState layout="row" title={strings.noCalendars} />
        ) : (
          <div role="group" aria-label={strings.chooseTitle}>
            {calendars.map((calendar) => (
              <SettingsRow key={calendar.id} title={calendar.name} control="inline">
                <Switch
                  label={strings.checkFor(calendar.name)}
                  isLabelHidden
                  isSelected={calendar.checkConflicts}
                  onChange={(isOn) => onCheck(calendar, isOn)}
                />
              </SettingsRow>
            ))}
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={strings.connectTitle}
      description={strings.connectText}
      isOpen={isOpen}
      isBusy={leavingFor !== undefined}
      onOpenChange={close}
    >
      <div role="group" aria-label={strings.connectTitle}>
        {providers.map((provider) => (
          <SettingsRow
            key={provider}
            title={PROVIDER[provider].name}
            description={PROVIDER[provider].accounts}
            leading={<ProviderMark provider={PROVIDER[provider].mark} />}
          >
            <Button
              label={strings.connectWith(PROVIDER[provider].name)}
              isPending={leavingFor === provider}
              isDisabled={leavingFor !== undefined && leavingFor !== provider}
              onPress={() => {
                setLeavingFor(provider);
                onPick(provider);
              }}
            >
              {strings.connectShort}
            </Button>
          </SettingsRow>
        ))}
      </div>
    </Modal>
  );
}
