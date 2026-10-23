// Brief
// Purpose: Settings › Super admin › Users › one person (spec 0047, AC-1630): their account, how often they come back,
// and what they made in each workspace in the period.
// Main task: understand one customer's usage before writing to them.
// Leaves out: what they wrote (records, notes and bookings stay theirs; only counts show), and changing the account.
import type { OperatorPeriod, OperatorUserDetail, OperatorUserWorkspace } from '@crm/data';
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
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { DayChart, PeriodSwitch } from './AdminParts.tsx';
import { formatters, plainStat, roleLabel } from './figures.ts';
import { strings } from './strings.ts';

/** Where the users list is, from a person's page. */
export const adminUsersHref = (slug: string) => `/w/${slug}/settings/admin/users`;

const COLUMNS: readonly TableColumn[] = [
  { id: 'workspace', label: strings.columns.workspace, isRowHeader: true, isInline: true },
  { id: 'role', label: strings.columns.role },
  { id: 'members', label: strings.columns.members, align: 'end' },
  { id: 'recordsAll', label: strings.columns.recordsAll, align: 'end' },
  { id: 'records', label: strings.columns.records, align: 'end' },
  { id: 'notes', label: strings.columns.notes, align: 'end' },
  { id: 'tasks', label: strings.columns.tasks, align: 'end' },
  { id: 'bookings', label: strings.columns.bookings, align: 'end' },
  { id: 'pages', label: strings.columns.pages, align: 'end' },
];

/** One person's page, loaded. */
export function UserScreen({ detail }: { readonly detail: OperatorUserDetail }) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const { slug = '' } = useParams({ strict: false });
  const { user } = detail;
  const name = user.name === '' ? user.email : user.name;
  const crumbs = [{ id: 'users', label: strings.users, href: adminUsersHref(slug) }];
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
        return format.count(workspace.records);
      case 'records':
        return format.count(workspace.recordsMade);
      case 'notes':
        return format.count(workspace.notesMade);
      case 'tasks':
        return format.count(workspace.tasksMade);
      case 'bookings':
        return format.count(workspace.bookingsHosted);
      case 'pages':
        return format.count(workspace.pagesOwned);
      default:
        return null;
    }
  };
  return (
    <SettingsPage title={name} crumbs={crumbs} actions={<PeriodSwitch period={detail.period} />}>
      <SettingsSection title={strings.accountSection}>
        <Card>
          <DescriptionList
            layout="columns"
            items={[
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
              { id: 'twoFactor', term: strings.twoFactor, description: user.twoFactor ? strings.on : strings.off },
              { id: 'devices', term: strings.signedInDevices, description: format.count(user.sessions) },
            ]}
          />
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.activitySection}>
        <Stats
          label={strings.activitySection}
          items={[
            plainStat('days', strings.columns.activeDays, format.count(user.activeDays)),
            plainStat('records', strings.columns.records, format.count(user.recordsMade)),
            plainStat('bookings', strings.columns.bookings, format.count(user.bookingsHosted)),
            plainStat('pages', strings.columns.pages, format.count(user.pages)),
          ]}
        />
        <DayChart
          title={strings.daysActive}
          days={detail.days.map((day) => ({ day: day.day, value: day.active ? 1 : 0 }))}
          unit={strings.units.activeDay}
        />
      </SettingsSection>
      <SettingsSection title={strings.workspacesSection}>
        <Table
          label={strings.workspacesTable}
          columns={COLUMNS}
          rows={detail.workspaces}
          getRowId={(workspace) => workspace.workspaceId}
          renderCell={cell}
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

/** One person's page while it loads. */
export function UserPending({ period }: { readonly period: OperatorPeriod }) {
  const { slug = '' } = useParams({ strict: false });
  return (
    <SettingsPage
      title={strings.users}
      crumbs={[{ id: 'users', label: strings.users, href: adminUsersHref(slug) }]}
      actions={<PeriodSwitch period={period} />}
      isLoading
    >
      <SettingsSection title={strings.activitySection}>
        <Stats label={strings.activitySection} items={[]} isLoading />
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
