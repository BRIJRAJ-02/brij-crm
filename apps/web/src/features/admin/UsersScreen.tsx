// Brief
// Purpose: Settings › Super admin › Users (spec 0047, AC-1630): every user, newest first, with their usage.
// Main task: find a user by name or email and see who signs up, comes back and uses the product; open one.
// Leaves out: changing an account (support access, plans and suspension are later slices), and anything a user wrote.
import type { DataLayer, OperatorPeriod, OperatorUserRow } from '@crm/data';
import { useOperator } from '@crm/data/react';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  focusLater,
  RelativeTime,
  Table,
  useFormatSettings,
  type TableColumn,
} from '@crm/ui';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { AdminFailed, useAdminRetry, PeriodSwitch } from './AdminParts.tsx';
import { formatters } from './figures.ts';
import { strings } from './strings.ts';

/** The users list's page size: an "all shown" line appears only past the first page. */
const OPERATOR_USERS_STEP = 50;

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

/** Where one user's page is. */
export const adminUserHref = (slug: string, userId: string) => `/w/${slug}/settings/admin/users/${userId}`;

/** Users for a period and a search (`q`, from the address): the list held in the data layer, a page at a time. */
export function UsersScreen({
  data,
  period,
  q,
}: {
  readonly data: DataLayer;
  readonly period: OperatorPeriod;
  readonly q: string;
}) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const navigate = useNavigate();
  const { slug = '' } = useParams({ strict: false });
  const list = useMemo(() => data.operator.users(period, q), [data, period, q]);
  const state = useOperator(list);
  const retry = useAdminRetry(list.retry);
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
  // Show more goes once the last page is in: focus then moves to the line saying all are shown, never to the
  // page's top. Asked only by a Show more, and forgotten as each one settles.
  const askedMore = useRef(false);
  const allShownRef = useRef<HTMLParagraphElement>(null);
  const isMoreLoading = state.status === 'ready' && state.isLoadingMore;
  const allShown = state.status === 'ready' && !state.hasMore && state.users.length > OPERATOR_USERS_STEP;
  useEffect(() => {
    if (isMoreLoading || !askedMore.current) return;
    askedMore.current = false;
    if (allShown) focusLater(() => allShownRef.current);
  }, [isMoreLoading, allShown]);
  const search = (value: string) => {
    setTyped(value);
    clearTimeout(rest.current);
    rest.current = setTimeout(() => {
      setSent(value.trim());
      void navigate({
        to: '.',
        replace: true,
        resetScroll: false,
        search: (previous: Record<string, unknown>) => {
          const { q: _q, ...kept } = previous;
          return value.trim() === '' ? kept : { ...kept, q: value.trim() };
        },
      });
    }, SEARCH_REST_MS);
  };
  if (state.status === 'error') {
    return <AdminFailed title={strings.users} error={state.error} data={data} onRetry={retry} />;
  }
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
  const isLoading = state.status === 'loading';
  return (
    <SettingsPage
      title={strings.users}
      {...(isLoading
        ? {}
        : {
            meta: (
              <Badge
                text={
                  state.users.length < state.total
                    ? strings.showing(format.count(state.users.length), format.count(state.total))
                    : strings.usersCount(format.count(state.total))
                }
              />
            ),
          })}
      actions={<PeriodSwitch period={period} />}
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
        rows={state.users}
        getRowId={(user) => user.id}
        renderCell={cell}
        isLoading={isLoading}
        isScrollable
        onRowAction={(id) => void navigate({ href: adminUserHref(slug, id) })}
        emptyState={
          q === '' ? (
            <EmptyState icon="users" title={strings.noUsers} />
          ) : (
            <EmptyState icon="search" title={strings.noMatches} />
          )
        }
      />
      {state.error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {strings.moreFailed}
        </Callout>
      )}
      {allShown && (
        <p ref={allShownRef} tabIndex={-1}>
          {strings.allShown(format.count(state.users.length))}
        </p>
      )}
      {state.hasMore && (
        <Button
          isPending={state.isLoadingMore}
          onPress={() => {
            askedMore.current = true;
            list.more();
          }}
        >
          {strings.showMore}
        </Button>
      )}
    </SettingsPage>
  );
}
