// Brief
// Purpose: Settings › Account › Calendars: the member's own calendar connections, so their meetings reach the records they're with.
// Main task: connect a Google calendar, see each one's state and last sync, choose who sees its meetings, disconnect.
// Leaves out: other members' calendars and Outlook (milestone 4). Owners and admins also choose whether meetings add people.
import { isDataError, type CalendarConnectionView, type CalendarView, type DataLayer } from '@crm/data';
import { useCalendar, useCalendarSettings } from '@crm/data/react';
import {
  Badge,
  Button,
  Callout,
  Card,
  DescriptionList,
  EmptyState,
  focusLater,
  Modal,
  RelativeTime,
  SegmentedControl,
  SettingsGrid,
  SettingsRow,
  SettingsSection,
  Skeleton,
  Switch,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { strings, type ConnectResult } from './calendar-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** The connections' section while they load: its title, and a busy card where the calendars will list. */
export function CalendarsLoading() {
  return (
    <SettingsSection title={strings.connectionsSection} description={strings.connectionsSectionText}>
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

/** One connection: its account, state and last sync, who sees its meetings, and Make default and Disconnect. */
function ConnectionCard({
  connection,
  onSharing,
  onDefault,
  onDisconnect,
  onSyncNow,
}: {
  readonly connection: CalendarConnectionView;
  readonly onSharing: (sharing: 'shared' | 'private') => void;
  readonly onDefault: () => void;
  readonly onDisconnect: () => void;
  /** Local development only (no push notices reach a laptop). */
  readonly onSyncNow?: () => void;
}) {
  const status = (
    <>
      <Badge text={strings.status[connection.status]} />
      {connection.lastError !== undefined && connection.status !== 'connected' && <> {connection.lastError.message}</>}
    </>
  );
  return (
    <Card
      title={connection.accountEmail}
      description={connection.isDefault ? `${strings.google} · ${strings.defaultBadge}` : strings.google}
      footer={
        <>
          {onSyncNow !== undefined && <Button onPress={onSyncNow}>{strings.syncNow}</Button>}
          {!connection.isDefault && <Button onPress={onDefault}>{strings.makeDefault}</Button>}
          <Button variant="danger" onPress={onDisconnect}>
            {strings.disconnect}
          </Button>
        </>
      }
    >
      <DescriptionList
        items={[
          { term: strings.terms.status, description: status },
          {
            term: strings.terms.lastSynced,
            description:
              connection.lastSyncedAt === undefined ? strings.notYet : <RelativeTime value={connection.lastSyncedAt} />,
          },
          {
            term: strings.terms.sharing,
            description: (
              <>
                <SegmentedControl
                  label={strings.sharingLabel}
                  segments={[
                    { value: 'shared', label: strings.shared },
                    { value: 'private', label: strings.private },
                  ]}
                  value={connection.sharing}
                  onChange={(value) => onSharing(value === 'private' ? 'private' : 'shared')}
                />{' '}
                {strings.sharingHelp[connection.sharing]}
              </>
            ),
          },
        ]}
      />
    </Card>
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
    data.calendar.remove(slug, disconnecting.id).then(
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
      <SettingsSection title={strings.connectionsSection} description={strings.connectionsSectionText}>
        {isFull && <Callout tone="info">{strings.limitReached(number.format(state.max))}</Callout>}
        <SettingsGrid>
          {state.connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              onSharing={(sharing) => void data.calendar.setSharing(slug, connection.id, sharing)}
              onDefault={() => void data.calendar.makeDefault(slug, connection.id)}
              onDisconnect={() => {
                setDisconnectFailure(undefined);
                setDisconnecting(connection);
              }}
              {...(import.meta.env.DEV ? { onSyncNow: () => void data.calendar.syncNow(slug, connection.id) } : {})}
            />
          ))}
        </SettingsGrid>
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
        <SettingsSection title={strings.workspaceSection} description={strings.workspaceSectionText}>
          <Card>
            <SettingsRow title={strings.createPeople} description={strings.createPeopleHelp}>
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
