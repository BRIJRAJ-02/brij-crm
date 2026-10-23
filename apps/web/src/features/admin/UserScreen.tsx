// Brief
// Purpose: Settings › Super admin › Users › one user (spec 0047, AC-1630): their account, how often they come back,
// and what they made in each workspace in the period.
// Main task: understand one customer's usage before writing to them.
// Leaves out: what they wrote (records and bookings show only as counts), and changing the account.
import {
  isDataError,
  type DataLayer,
  type OperatorPeriod,
  type OperatorUserDetail,
  type OperatorUserWorkspace,
} from '@crm/data';
import { useOperator } from '@crm/data/react';
import {
  Badge,
  Card,
  DescriptionList,
  EmptyState,
  Link,
  RelativeTime,
  SettingsSection,
  Stats,
  Table,
  useFormatSettings,
  type TableColumn,
} from '@crm/ui';
import { useParams } from '@tanstack/react-router';
import { useMemo } from 'react';
import { SettingsMissing, SettingsPage } from '../settings/SettingsPage.tsx';
import { AdminFailed, DayChart, PeriodSwitch, useIsOperator } from './AdminParts.tsx';
import { formatters, plainStat, roleLabel } from './figures.ts';
import { strings } from './strings.ts';

/** The most live records a workspace row counts to (the contract's `OPERATOR_RECORDS_CAP`). */
const RECORDS_CAP = 100_000;

/** Where the users list is, from a user's page. */
export const adminUsersHref = (slug: string) => `/w/${slug}/settings/admin/users`;

const COLUMNS: readonly TableColumn[] = [
  { id: 'workspace', label: strings.columns.workspace, isRowHeader: true, isInline: true },
  { id: 'role', label: strings.columns.role },
  { id: 'members', label: strings.columns.members, align: 'end' },
  { id: 'recordsAll', label: strings.columns.recordsAll, align: 'end' },
  { id: 'records', label: strings.columns.records, align: 'end' },
  { id: 'bookings', label: strings.columns.bookings, align: 'end' },
  { id: 'pages', label: strings.columns.pages, align: 'end' },
];

/** One user's page for a period, its read held in the data layer. */
export function UserScreen({
  data,
  userId,
  period,
}: {
  readonly data: DataLayer;
  readonly userId: string;
  readonly period: OperatorPeriod;
}) {
  const held = useMemo(() => data.operator.user(userId, period), [data, userId, period]);
  const state = useOperator(held);
  const isOperator = useIsOperator();
  if (state.status === 'error') {
    // No such account: its own page for a super admin, and Settings' "nothing here" for anyone else.
    if (isDataError(state.error) && (state.error.code === 'NOT_FOUND' || state.error.code === 'INPUT_INVALID')) {
      return isOperator ? <UserMissing /> : <SettingsMissing backTo="home" />;
    }
    return <AdminFailed title={strings.users} error={state.error} data={data} onRetry={held.retry} />;
  }
  return <UserBody period={period} detail={state.status === 'ready' ? state.value : undefined} />;
}

/** A user's page: their facts, activity and workspaces, or their loading shapes while `detail` is undefined. */
export function UserBody({
  period,
  detail,
}: {
  readonly period: OperatorPeriod;
  readonly detail: OperatorUserDetail | undefined;
}) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const { slug = '' } = useParams({ strict: false });
  const user = detail?.user;
  const name = user === undefined ? strings.users : user.name === '' ? user.email : user.name;
  const cell = (workspace: OperatorUserWorkspace, column: string) => {
    switch (column) {
      case 'workspace':
        return (
          <>
            {workspace.name}
            {workspace.deleted && <Badge text={strings.deleted} />}
          </>
        );
      case 'role':
        return workspace.status === 'active' ? roleLabel(workspace.role) : strings.removed;
      case 'members':
        return format.count(workspace.members);
      case 'recordsAll':
        return format.capped(workspace.records, RECORDS_CAP);
      case 'records':
        return format.count(workspace.recordsMade);
      case 'bookings':
        return format.count(workspace.bookingsHosted);
      case 'pages':
        return format.count(workspace.pagesOwned);
      default:
        return null;
    }
  };
  return (
    <SettingsPage
      title={name}
      crumbs={[{ id: 'users', label: strings.users, href: adminUsersHref(slug) }]}
      actions={<PeriodSwitch period={period} />}
      isLoading={user === undefined}
    >
      <SettingsSection title={strings.accountSection}>
        <Card isBusy={user === undefined}>
          <DescriptionList
            layout="columns"
            items={
              user === undefined
                ? [
                    { id: 'email', term: strings.email, description: '', isPlaceholder: true },
                    { id: 'signedUp', term: strings.columns.signedUp, description: '', isPlaceholder: true },
                    { id: 'lastActive', term: strings.columns.lastActive, description: '', isPlaceholder: true },
                  ]
                : [
                    {
                      id: 'email',
                      term: strings.email,
                      description: user.emailVerified ? user.email : `${user.email} (${strings.emailUnverified})`,
                      copy: { value: user.email, label: strings.email },
                    },
                    { id: 'signedUp', term: strings.columns.signedUp, description: format.date(user.createdAt) },
                    {
                      id: 'lastActive',
                      term: strings.columns.lastActive,
                      description:
                        user.lastActiveAt === undefined ? strings.never : <RelativeTime value={user.lastActiveAt} />,
                    },
                    {
                      id: 'methods',
                      term: strings.signIn,
                      description: user.methods.map((method) => strings.methods[method]).join(', '),
                    },
                    {
                      id: 'twoFactor',
                      term: strings.twoFactor,
                      description: user.twoFactor ? strings.on : strings.off,
                    },
                    { id: 'devices', term: strings.signedInDevices, description: format.count(user.sessions) },
                  ]
            }
          />
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.activitySection}>
        <Stats
          label={strings.activitySection}
          isLoading={user === undefined}
          items={
            user === undefined
              ? []
              : [
                  plainStat('days', strings.columns.activeDays, format.count(user.activeDays)),
                  plainStat('records', strings.columns.records, format.count(user.recordsMade)),
                  plainStat('bookings', strings.columns.bookings, format.count(user.bookingsHosted)),
                  plainStat('pages', strings.columns.pages, format.count(user.pages)),
                ]
          }
        />
        <DayChart
          title={strings.daysActive}
          days={detail?.days.map((day) => ({ day: day.day, value: day.active ? 1 : 0 }))}
          period={period}
          unit=""
          barLabel={(day, value) => (value > 0 ? strings.dayActive(day) : strings.dayIdle(day))}
          summary={(days) => strings.activeDaysSummary(format.count(days.filter((day) => day.value > 0).length))}
        />
      </SettingsSection>
      <SettingsSection title={strings.workspacesSection}>
        <Table
          label={strings.workspacesTable}
          columns={COLUMNS}
          rows={detail?.workspaces ?? []}
          getRowId={(workspace) => workspace.workspaceId}
          renderCell={cell}
          isLoading={detail === undefined}
          isScrollable
          emptyState={
            <EmptyState icon="building" title={strings.noWorkspaces}>
              {strings.noWorkspacesText}
            </EmptyState>
          }
        />
      </SettingsSection>
    </SettingsPage>
  );
}

/** No such account: the way back to the list. */
export function UserMissing() {
  const { slug = '' } = useParams({ strict: false });
  return (
    <SettingsPage
      title={strings.userMissing}
      crumbs={[{ id: 'users', label: strings.users, href: adminUsersHref(slug) }]}
    >
      <EmptyState
        icon="search"
        title={strings.userMissing}
        actions={<Link href={adminUsersHref(slug)}>{strings.backToUsers}</Link>}
      >
        {strings.userMissingText}
      </EmptyState>
    </SettingsPage>
  );
}
