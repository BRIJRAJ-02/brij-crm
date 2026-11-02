import { createFileRoute, redirect } from '@tanstack/react-router';

// Bookings › Routing was a tab of its own until 2 November 2026; it is now Hosts › Rules. A link people already
// hold lands there carrying everything it had: which part of Routing (`view`), its filters and the decision open.
// Whether the reader may see it at all is still `routing.manage`, checked by the Hosts route's loader, which
// sends anyone else to the groups rather than to an empty page.

/** What the old address carried, as the Hosts route reads it back. */
interface RoutingLink {
  readonly view: 'overview' | 'decisions' | 'skills' | 'test';
  readonly surface?: string;
  readonly rule?: string;
  readonly host?: string;
  readonly tag?: 'yes' | 'no' | 'none';
  readonly period?: 'today' | '7' | '30' | '90';
  readonly decision?: string;
}

export const Route = createFileRoute('/w/$slug/bookings/routing')({
  validateSearch: (raw: Record<string, unknown>): RoutingLink => {
    const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
    const tag = text(raw.tag);
    const period = text(raw.period);
    const surface = text(raw.surface);
    const rule = text(raw.rule);
    const host = text(raw.host);
    const decision = text(raw.decision);
    return {
      view: raw.view === 'decisions' || raw.view === 'skills' || raw.view === 'test' ? raw.view : 'overview',
      ...(surface === undefined ? {} : { surface }),
      ...(rule === undefined ? {} : { rule }),
      ...(host === undefined ? {} : { host }),
      ...(tag === 'yes' || tag === 'no' || tag === 'none' ? { tag } : {}),
      ...(period === 'today' || period === '7' || period === '30' || period === '90' ? { period } : {}),
      ...(decision === undefined ? {} : { decision }),
    };
  },
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/hosts',
      params: { slug: params.slug },
      search: { v: 'rules' as const, ...search },
      replace: true,
    });
  },
});
