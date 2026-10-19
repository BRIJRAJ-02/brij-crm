// Brief
// Purpose: Settings, Calendar: the member's own calendar connections, so their meetings reach the records they're with.
// Main task: connect a Google calendar, see each one's state and last sync, choose who sees its meetings, disconnect.
// Leaves out: other members' calendars, Outlook (milestone 4), the disconnected banner and Add as person (milestone 2).
import type { CalendarConnectionView, CalendarView, DataLayer } from '@crm/data';
import { useCalendar } from '@crm/data/react';
import {
  Badge,
  Button,
  Callout,
  Card,
  DescriptionList,
  EmptyState,
  Modal,
  RelativeTime,
  SegmentedControl,
  Skeleton,
} from '@crm/ui';
import { useState } from 'react';
import { strings, type ConnectResult } from './calendar-strings.ts';
import { settingsCrumbs, SettingsPage } from './SettingsPage.tsx';

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
}: {
  readonly connection: CalendarConnectionView;
  readonly onSharing: (sharing: 'shared' | 'private') => void;
  readonly onDefault: () => void;
  readonly onDisconnect: () => void;
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
  const [disconnecting, setDisconnecting] = useState<CalendarConnectionView | undefined>(undefined);
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
    body = (
      <Card isBusy>
        <Skeleton width="long" />
        <Skeleton width="medium" />
      </Card>
    );
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
            <Button variant="primary" icon="calendar" onPress={connect}>
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
      <>
        {isFull && <Callout tone="info">{strings.limitReached(number.format(state.max))}</Callout>}
        {state.connections.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            onSharing={(sharing) => void data.calendar.setSharing(slug, connection.id, sharing)}
            onDefault={() => void data.calendar.makeDefault(slug, connection.id)}
            onDisconnect={() => setDisconnecting(connection)}
          />
        ))}
      </>
    );
  }

  return (
    <SettingsPage
      title={strings.title}
      crumbs={settingsCrumbs(slug, 'objects')}
      description={strings.description}
      current="calendar"
      isLoading={state.status === 'loading'}
      {...(canConnect && hasList
        ? {
            actions: (
              <Button icon="calendar" onPress={connect}>
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
      <Modal
        title={strings.disconnectTitle}
        tone="danger"
        isOpen={disconnecting !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDisconnecting(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.keep}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                if (disconnecting !== undefined) void data.calendar.remove(slug, disconnecting.id);
                setDisconnecting(undefined);
              }}
            >
              {strings.disconnect}
            </Button>
          </>
        }
      >
        {strings.disconnectText(disconnecting?.accountEmail ?? '')}
      </Modal>
    </SettingsPage>
  );
}
