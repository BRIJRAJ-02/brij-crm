// Brief
// Purpose: Settings › Account › Calendars: the member's own calendar connections, so their meetings reach the records they're with.
// Main task: connect a Google calendar, see each one's state and last sync, choose who sees its meetings, disconnect.
// Leaves out: other members' calendars and Outlook (milestone 4). Owners and admins also choose whether meetings add people.
import {
  isDataError,
  needsReconnect,
  type CalendarConnectionView,
  type CalendarStatus,
  type CalendarView,
  type DataLayer,
  type Hue,
} from '@crm/data';
import { useCalendar, useCalendarSettings } from '@crm/data/react';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  focusLater,
  InfoTip,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  ProviderMark,
  RelativeTime,
  Select,
  SettingsRow,
  SettingsSection,
  Skeleton,
  Switch,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { strings, type ConnectResult } from './calendar-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** The connections' section while they load: its heading, and a busy card where the calendars will list. */
export function CalendarsLoading() {
  return (
    <SettingsSection title={strings.connectionsSection}>
      <Card isBusy>
        <Skeleton width="long" />
        <Skeleton width="medium" />
      </Card>
    </SettingsSection>
  );
}

/** Props for the Calendar screen: what its route loaded through the data layer. */
export interface CalendarScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly view: CalendarView;
  /** What the browser came back from Google with, once (`?calendar=`). */
  readonly result?: ConnectResult;
  /** Clears `?calendar=` once the person has read it. */
  readonly onResultSeen: () => void;
}

const number = new Intl.NumberFormat();

/** Each connection state's dot: green when it syncs, blue while it starts, orange when it needs a reconnect, red when it broke. */
const STATUS_HUE = {
  syncing: 'blue',
  connected: 'green',
  expired: 'orange',
  revoked: 'red',
  failed: 'red',
} as const satisfies Record<CalendarStatus, Hue>;

/** Who sees a calendar's meetings, each choice saying what others see. */
const SHARING = [
  { id: 'shared', label: strings.shared, icon: 'users', description: strings.sharingHelp.shared },
  { id: 'private', label: strings.private, icon: 'lock', description: strings.sharingHelp.private },
] as const;

/**
 * One connection as a row (the owner, 21 October 2026: a compact row per
 * account, as Attio and Calendly list them): the provider's mark, the account,
 * a Default badge, its state and last sync, who sees its meetings, and a
 * "···" menu with Make default and Disconnect (which asks first).
 */
function ConnectionRow({
  connection,
  onSharing,
  onDefault,
  onDisconnect,
  onReconnect,
  onSyncNow,
}: {
  readonly connection: CalendarConnectionView;
  /** Connects the account again, offered once it stopped syncing (expired, revoked or failed); absent when connecting is off. */
  readonly onReconnect?: () => void;
  readonly onSharing: (sharing: 'shared' | 'private') => void;
  readonly onDefault: () => void;
  readonly onDisconnect: () => void;
  /** Local development only (no push notices reach a laptop). */
  readonly onSyncNow?: () => void;
}) {
  const problem =
    connection.lastError !== undefined && connection.status !== 'connected' ? connection.lastError.message : undefined;
  const actions = strings.rowActions(connection.accountEmail);
  const canReconnect = onReconnect !== undefined && needsReconnect(connection);
  return (
    <SettingsRow
      title={connection.accountEmail}
      leading={<ProviderMark provider="google-calendar" isLabelled />}
      {...(connection.isDefault
        ? {
            meta: (
              <>
                <Badge text={strings.defaultBadge} />
                <InfoTip label={strings.defaultBadge}>{strings.defaultHelp}</InfoTip>
              </>
            ),
          }
        : {})}
      description={
        <>
          <Badge text={strings.status[connection.status]} dot={STATUS_HUE[connection.status]} />
          {' · '}
          {connection.lastSyncedAt === undefined ? (
            strings.notSyncedYet
          ) : (
            <>
              {/* A no break space: "Synced" never ends a line on its own. */}
              {strings.synced}
              {'\u00a0'}
              <RelativeTime value={connection.lastSyncedAt} />
            </>
          )}
          {problem !== undefined && <> · {problem}</>}
        </>
      }
    >
      {/* A calendar that stopped syncing shows its fix on the row, not behind the menu. */}
      {canReconnect && <Button onPress={onReconnect}>{strings.reconnect}</Button>}
      <Select
        label={strings.sharingLabel}
        isLabelHidden
        items={SHARING}
        value={connection.sharing}
        onChange={(value) => onSharing(value === 'private' ? 'private' : 'shared')}
      />
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={actions} />
        <Menu
          label={actions}
          onAction={(key) => {
            if (key === 'default') onDefault();
            if (key === 'sync') onSyncNow?.();
            if (key === 'disconnect') onDisconnect();
          }}
        >
          {!connection.isDefault && (
            <MenuItem id="default" icon="star">
              {strings.makeDefault}
            </MenuItem>
          )}
          {onSyncNow !== undefined && (
            <MenuItem id="sync" icon="refresh-cw">
              {strings.syncNow}
            </MenuItem>
          )}
          {(!connection.isDefault || onSyncNow !== undefined) && <MenuSeparator />}
          <MenuItem id="disconnect" icon="unplug" isDanger>
            {strings.disconnect}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    </SettingsRow>
  );
}

/** Settings, Calendar (spec 0024): the member's connections, live while shown, and Connect Google calendar. */
export function CalendarScreen({ data, slug, view, result, onResultSeen }: CalendarScreenProps) {
  const state = useCalendar(view);
  const settings = useCalendarSettings(data.calendar.settings(slug));
  const { toasts } = useRouteContext({ from: '__root__' });
  const [disconnecting, setDisconnecting] = useState<CalendarConnectionView | undefined>(undefined);
  const [isDisconnectBusy, setDisconnectBusy] = useState(false);
  // The last calendar the confirm was opened for: it stays named through the confirm's exit.
  const [lastDisconnecting, setLastDisconnecting] = useState<CalendarConnectionView | undefined>(undefined);
  if (disconnecting !== undefined && disconnecting !== lastDisconnecting) setLastDisconnecting(disconnecting);
  // Connect Google calendar (in the bar, or the empty state's): where focus goes once a calendar is disconnected.
  const connectRef = useRef<HTMLButtonElement>(null);
  const [disconnectFailure, setDisconnectFailure] = useState<string | undefined>(undefined);
  const disconnect = () => {
    if (disconnecting === undefined || isDisconnectBusy) return;
    setDisconnectBusy(true);
    setDisconnectFailure(undefined);
    data.calendar.remove(slug, disconnecting.id, { asksFirst: true }).then(
      (isDone) => {
        setDisconnectBusy(false);
        // Refused (the connection came back): the confirm stays open and says so.
        if (!isDone) {
          setDisconnectFailure(strings.disconnectFailed);
          return;
        }
        toasts.toast({ tone: 'success', message: strings.disconnected(disconnecting.accountEmail) });
        setDisconnecting(undefined);
        // Its card went with it, and the Disconnect that opened the confirm: focus goes to Connect.
        focusLater(() => connectRef.current);
      },
      (error: unknown) => {
        // The confirm stays open with what went wrong, so the person can try again or cancel.
        setDisconnectBusy(false);
        setDisconnectFailure(isDataError(error) ? error.message : strings.disconnectFailed);
      },
    );
  };
  const outcome = result === undefined ? undefined : strings.results[result];
  // Connecting is the browser going to the API, which sends it on to Google's consent screen and back here.
  const connect = () => {
    window.location.assign(data.calendar.connectUrl(slug));
  };
  const isFull = state.status === 'ready' && state.connections.length >= state.max;
  // Reconnecting goes through the same consent and lands on the same connection, so the limit doesn't stop it.
  const canReconnect = state.status === 'ready' && state.enabled && state.providers.includes('google');
  const canConnect = state.status === 'ready' && state.enabled && state.providers.includes('google') && !isFull;
  // The header's Connect sits beside a list; an empty page offers it in its own empty state.
  const hasList = state.status === 'ready' && state.connections.length > 0;

  let body;
  if (state.status === 'loading') {
    // The connections' section, busy, so the cards arrive in its column.
    body = <CalendarsLoading />;
  } else if (state.status === 'error') {
    body = (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => view.reload()}>
        {state.message}
      </EmptyState>
    );
  } else if (!state.enabled && state.connections.length === 0) {
    body = (
      <EmptyState icon="calendar" title={strings.offTitle}>
        {strings.offText}
      </EmptyState>
    );
  } else if (state.connections.length === 0) {
    body = (
      <EmptyState
        icon="calendar"
        title={strings.emptyTitle}
        actions={
          canConnect ? (
            <Button ref={connectRef} provider="google-calendar" onPress={connect}>
              {strings.connectGoogle}
            </Button>
          ) : undefined
        }
      >
        {strings.emptyText}
      </EmptyState>
    );
  } else {
    body = (
      <SettingsSection title={strings.connectionsSection}>
        {isFull && <Callout tone="info">{strings.limitReached(number.format(state.max))}</Callout>}
        <Card>
          {state.connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              onSharing={(sharing) => void data.calendar.setSharing(slug, connection.id, sharing)}
              onDefault={() => void data.calendar.makeDefault(slug, connection.id)}
              {...(canReconnect ? { onReconnect: connect } : {})}
              onDisconnect={() => {
                setDisconnectFailure(undefined);
                setDisconnecting(connection);
              }}
              {...(import.meta.env.DEV ? { onSyncNow: () => void data.calendar.syncNow(slug, connection.id) } : {})}
            />
          ))}
        </Card>
      </SettingsSection>
    );
  }

  return (
    <SettingsPage
      title={strings.title}
      isLoading={state.status === 'loading'}
      {...(canConnect && hasList
        ? {
            actions: (
              <Button ref={connectRef} provider="google-calendar" onPress={connect}>
                {strings.connectGoogle}
              </Button>
            ),
          }
        : {})}
    >
      {outcome !== undefined && (
        <Callout
          tone={outcome.tone}
          title={outcome.title}
          isAnnounced
          actions={
            <Button variant="ghost" onPress={onResultSeen}>
              {strings.dismiss}
            </Button>
          }
        >
          {outcome.text}
        </Callout>
      )}
      {body}
      {/* Off while calendar sync isn't set up here, where it could do nothing. */}
      {settings.status === 'ready' && settings.canManage && state.status === 'ready' && state.enabled && (
        <SettingsSection title={strings.workspaceSection}>
          <Card>
            <SettingsRow
              title={strings.createPeople}
              description={strings.createPeopleHelp}
              meta={
                <InfoTip label={strings.createPeople} example={strings.createPeopleExample}>
                  {strings.createPeopleInfo}
                </InfoTip>
              }
            >
              <Switch
                label={strings.createPeople}
                isLabelHidden
                isSelected={settings.createUnknownPeople}
                onChange={(isSelected) => void data.calendar.setCreateUnknownPeople(slug, isSelected)}
              />
            </SettingsRow>
          </Card>
        </SettingsSection>
      )}
      <Modal
        title={strings.disconnectTitle(lastDisconnecting?.accountEmail ?? '')}
        tone="danger"
        isOpen={disconnecting !== undefined}
        isBusy={isDisconnectBusy}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isDisconnectBusy) setDisconnecting(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isDisconnectBusy} kbd="ESC">
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isDisconnectBusy} onPress={disconnect}>
              {isDisconnectBusy ? strings.disconnecting : strings.disconnect}
            </Button>
          </>
        }
      >
        {disconnectFailure !== undefined && <Callout tone="danger">{disconnectFailure}</Callout>}
        {strings.disconnectText}
      </Modal>
    </SettingsPage>
  );
}
