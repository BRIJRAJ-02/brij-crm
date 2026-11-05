// Routing's address and loader (spec 0037, AC-1383), apart from the screen so both of its routes (Bookings › Routing
// and Settings › Scheduling › Routing, 5 November 2026) read the same search and load the same way, and a loader
// never imports the screen module (the first load).
import { isDataError, type AttributeDefinition, type DataLayer, type MemberView } from '@crm/data';
import type { RoutingSearch } from './RoutingScreen.tsx';

/** The page's search, read from the address: Overview by default, Decisions with its filters, Skills, Test. */
export function routingSearch(raw: Record<string, unknown>): RoutingSearch {
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
}

/** What the page needs: the members (Skills) and Deals' Stage (Won means); nothing without routing.manage. */
export interface RoutingLoad {
  readonly members?: readonly MemberView[];
  readonly stage?: AttributeDefinition;
}

/**
 * The page's load: the access read first, from the data layer's cache, so nothing else is asked for anyone without
 * routing.manage (hidden means absent). An unknown workspace loads nothing; the frame above says so.
 */
export async function loadRouting(data: DataLayer, slug: string): Promise<RoutingLoad> {
  try {
    const access = await data.access.mine(slug);
    if (!access.permissions.includes('routing.manage')) return {};
    const [members, stage] = await Promise.all([data.members.list(slug), dealsStage(data, slug)]);
    return { members, ...(stage === undefined ? {} : { stage }) };
  } catch (error) {
    if (isDataError(error) && error.code === 'NOT_FOUND') return {};
    throw error;
  }
}

/** Deals' Stage field (api slug `stage`), for Won means (spec 0037, AC-1385); none when Deals or the field is hidden. */
async function dealsStage(data: DataLayer, slug: string): Promise<AttributeDefinition | undefined> {
  const objects = await data.objects.list(slug);
  const deals = objects.find((each) => each.standardKey === 'deals');
  if (deals === undefined) return undefined;
  const attributes = await data.attributes.list(slug, deals.id);
  return attributes.find((each) => each.apiSlug === 'stage' && !each.isArchived);
}
