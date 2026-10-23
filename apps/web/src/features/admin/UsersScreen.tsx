// Brief
// Purpose: Settings › Super admin › Users (spec 0047, AC-1630): every account, newest first, with its usage.
// Main task: find a person by name or email and see who signs up, comes back and uses the product; open one.
// Leaves out: changing an account (support access, plans and suspension are later slices), and anything a person wrote.
import type { OperatorPeriod, OperatorUserPage, OperatorUserRow } from '@crm/data';
import { Badge, Button, EmptyState, Field, RelativeTime, Table, useFormatSettings, type TableColumn } from '@crm/ui';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { PeriodSwitch } from './AdminParts.tsx';
import { formatters, USERS_MAX, USERS_STEP } from './figures.ts';
import { strings } from './strings.ts';

/** How long typing rests before the search reads. */
const SEARCH_REST_MS = 250;

const COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.columns.name, isRowHeader: true },
  { id: 'email', label: strings.email },
  { id: 'signedUp', label: strings.columns.signedUp },
  { id: 'lastActive', label: strings.columns.lastActive },
  { id: 'activeDays', label: strings.columns.activeDays, align: 'end' },
  { id: 'workspaces', label: strings.columns.workspaces, align: 'end' },
  { id: 'records', label: strings.columns.records, align: 'end' },
  { id: 'bookings', label: strings.columns.bookings, align: 'end' },
  { id: 'pages', label: strings.columns.pages, align: 'end' },
];

/** Where one person's page is. */
export const adminUserHref = (slug: string, userId: string) => `/w/${slug}/settings/admin/users/${userId}`;

/** Props for the users list. */
export interface UsersScreenProps {
  readonly page: OperatorUserPage;
  readonly q: string;
  readonly shown: number;
}

/** Users, loaded: the search over the table, and Show more while there are more. */
export function UsersScreen({ page, q, shown }: UsersScreenProps) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const navigate = useNavigate();
  const { slug = '' } = useParams({ strict: false });
  const [typed, setTyped] = useState(q);
  // The search this field last sent, and the address's last one: when the address changes to something the field
  // didn't send (Back, a link), the field follows it; its own search coming back never overwrites what was typed since.
  const [sent, setSent] = useState(q);
  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    setSeen(q);
    if (q !== sent) setTyped(q);
  }
  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(rest.current), []);
  const search = (value: string) => {
    setTyped(value);
    clearTimeout(rest.current);
    rest.current = setTimeout(() => {
      setSent(value.trim());
      void navigate({
        to: '.',
        replace: true,
        search: (previous: Record<string, unknown>) => {
          const { q: _q, shown: _shown, ...kept } = previous;
          return value.trim() === '' ? kept : { ...kept, q: value.trim() };
        },
      });
    }, SEARCH_REST_MS);
  };
  const cell = (user: OperatorUserRow, column: string) => {
    switch (column) {
      case 'name':
        return user.name === '' ? strings.unnamed : user.name;
      case 'email':
        return user.email;
      case 'signedUp':
        return format.date(user.createdAt);
      case 'lastActive':
        return user.lastActiveAt === undefined ? strings.never : <RelativeTime value={user.lastActiveAt} />;
      case 'activeDays':
        return format.count(user.activeDays);
      case 'workspaces':
        return format.count(user.workspaces);
      case 'records':
        return format.count(user.recordsMade);
      case 'bookings':
        return format.count(user.bookingsHosted);
      case 'pages':
        return format.count(user.pages);
      default:
        return null;
    }
  };
  const canShowMore = page.next !== undefined && shown < USERS_MAX;
  return (
    <SettingsPage
      title={strings.users}
      meta={<Badge text={strings.peopleCount(format.count(page.total))} />}
      actions={<PeriodSwitch period={page.period} />}
    >
      <Field
        label={strings.searchLabel}
        isLabelHidden
        variant="search"
        type="search"
        placeholder={strings.searchPlaceholder}
        value={typed}
        onChange={search}
        autoComplete="off"
      />
      <Table
        label={strings.usersTable}
        columns={COLUMNS}
        rows={page.users}
        getRowId={(user) => user.id}
        renderCell={cell}
        isScrollable
        onRowAction={(id) => void navigate({ href: adminUserHref(slug, id) })}
        emptyState={
          q === '' ? (
            <EmptyState icon="users" title={strings.noUsers}>
              {strings.noUsersText}
            </EmptyState>
          ) : (
            <EmptyState icon="search" title={strings.noMatches}>
              {strings.noMatchesText}
            </EmptyState>
          )
        }
      />
      {canShowMore && (
        <Button
          onPress={() =>
            void navigate({
              to: '.',
              replace: true,
              resetScroll: false,
              search: (previous: Record<string, unknown>) => ({ ...previous, shown: shown + USERS_STEP }),
            })
          }
        >
          {strings.showMore}
        </Button>
      )}
    </SettingsPage>
  );
}

/** Users while it loads: the search and the table's skeleton rows. */
export function UsersPending({ period }: { readonly period: OperatorPeriod }) {
  return (
    <SettingsPage title={strings.users} actions={<PeriodSwitch period={period} />}>
      <Field
        label={strings.searchLabel}
        isLabelHidden
        variant="search"
        placeholder={strings.searchPlaceholder}
        isDisabled
      />
      <Table
        label={strings.usersTable}
        columns={COLUMNS}
        rows={[]}
        getRowId={() => ''}
        renderCell={() => null}
        isLoading
      />
    </SettingsPage>
  );
}
