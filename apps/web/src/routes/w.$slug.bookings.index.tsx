import { isDataError, type BookingsTab } from '@crm/data';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import {
  BookingsFailed,
  BookingsPending,
  BookingsScreen,
  type BookingsSearch,
} from '../features/bookings/BookingsScreen.tsx';
import { strings } from '../features/bookings/strings.ts';
import { dayKeyOf, isDayKey, weekOf, weekRange } from '../features/bookings/week.ts';

// Bookings (spec 0025, AC-646): the week calendar (`?view=week`, the default) with the reader's own calendar
// events beside the bookings, or the list (`?view=list`) by tab (`tab`), page (`page`, `per`) and sort (`sort`);
// `w` is the week's Monday, `d` the day picked, `link` one booking page, `conn` the calendars shown. The loader
// waits for what the view needs through the data layer; the screen holds the reads, so each is read again
// whenever the person comes back to the page (bookings have no change event yet).

/** The address as it is written. */
interface RawSearch {
  readonly view?: 'list';
  readonly w?: string;
  readonly d?: string;
  readonly tab?: 'past' | 'cancelled';
  readonly page?: number;
  readonly per?: number;
  readonly sort?: 'asc' | 'desc';
  readonly link?: string;
  readonly conn?: string;
}

const SIZES = [10, 25, 50, 100];

export const Route = createFileRoute('/w/$slug/bookings/')({
  validateSearch: (search: Record<string, unknown>): RawSearch => {
    const number = (value: unknown) => (typeof value === 'number' ? value : Number(value));
    const page = number(search.page);
    const per = number(search.per);
    return {
      ...(search.view === 'list' ? { view: 'list' } : {}),
      ...(isDayKey(search.w) ? { w: search.w } : {}),
      ...(isDayKey(search.d) ? { d: search.d } : {}),
      ...(search.tab === 'past' || search.tab === 'cancelled' ? { tab: search.tab } : {}),
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
      ...(SIZES.includes(per) && per !== 10 ? { per } : {}),
      ...(search.sort === 'asc' || search.sort === 'desc' ? { sort: search.sort } : {}),
      ...(typeof search.link === 'string' && /^[0-9a-f-]{36}$/i.test(search.link) ? { link: search.link } : {}),
      ...(typeof search.conn === 'string' && search.conn.length <= 2_000 ? { conn: search.conn } : {}),
    };
  },
  loaderDeps: ({ search }): { readonly view: 'week' | 'list'; readonly week: string; readonly tab: BookingsTab } => ({
    view: search.view ?? 'week',
    week: search.w ?? weekOf(search.d ?? dayKeyOf(new Date())),
    tab: search.tab ?? 'upcoming',
  }),
  loader: async ({ context, params, deps }) => {
    const { data } = context;
    const lists = {
      upcoming: data.bookings.view(params.slug, 'upcoming'),
      past: data.bookings.view(params.slug, 'past'),
      cancelled: data.bookings.view(params.slug, 'cancelled'),
    };
    const range = weekRange(deps.week);
    const week = data.bookings.calendar(params.slug, range.from, range.to);
    const calendar = data.calendar.view(params.slug);
    const [objects, pages] = await Promise.all([
      data.objects.list(params.slug),
      // The Link filter's choices; a member without booking pages has none.
      data.bookingPages.list(params.slug).catch(() => []),
      deps.view === 'week' ? week.ready() : lists[deps.tab].ready(),
      calendar.ready().catch(() => undefined),
    ]);
    const connections = (() => {
      const state = calendar.getSnapshot();
      return state.status === 'ready' ? state.connections.filter((each) => each.status !== 'revoked') : [];
    })();
    return { lists, week, objects, pages, connections };
  },
  pendingComponent: BookingsPending,
  errorComponent: BookingsError,
  component: BookingsRoute,
});

function BookingsRoute() {
  const { lists, week, objects, pages, connections } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const raw = Route.useSearch();
  const navigate = useNavigate();
  const today = dayKeyOf(new Date());
  const day = raw.d ?? (raw.w === undefined ? today : raw.w);
  const search: BookingsSearch = {
    view: raw.view ?? 'week',
    week: raw.w ?? weekOf(day),
    day,
    tab: raw.tab ?? 'upcoming',
    page: raw.page ?? 1,
    per: raw.per ?? 10,
    ...(raw.sort === undefined ? {} : { sort: raw.sort }),
    ...(raw.link === undefined ? {} : { link: raw.link }),
    ...(raw.conn === undefined ? {} : { conn: raw.conn === '' ? [] : raw.conn.split(',') }),
  };
  return (
    <BookingsScreen
      slug={slug}
      search={search}
      lists={lists}
      week={week}
      objects={objects}
      pages={pages}
      connections={connections}
      locale={navigator.languages[0] ?? 'en-GB'}
      onSearch={(next) => {
        const merged = { ...search, ...next };
        void navigate({
          to: '/w/$slug/bookings',
          params: { slug },
          replace: true,
          search: {
            ...(merged.view === 'list' ? { view: 'list' as const } : {}),
            w: merged.week,
            d: merged.day,
            ...(merged.tab === 'upcoming' ? {} : { tab: merged.tab }),
            ...(merged.page > 1 ? { page: merged.page } : {}),
            ...(merged.per === 10 ? {} : { per: merged.per }),
            ...(merged.sort === undefined ? {} : { sort: merged.sort }),
            ...(merged.link === undefined ? {} : { link: merged.link }),
            ...(merged.conn === undefined ? {} : { conn: merged.conn.join(',') }),
          },
        });
      }}
    />
  );
}

function BookingsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <BookingsFailed
      message={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
