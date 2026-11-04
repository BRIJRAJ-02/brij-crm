// The desk's offered times for one service on a place date (spec 0066 B1's proof that the catalogue, the staff and
// their shifts plan a visit; the calendar of B3 books from it): `visitTimes` with one item, each start with the staff
// member it would go to. `services.calendar` only (checked by `visitTimes` before anything is read).
import type { ServiceTimesView } from '@crm/contracts';
import type { EngineScope } from '../access/mint.ts';
import { requirePermission } from '../access/check.ts';
import { checkId } from '../engine/ids.ts';
import { visitTimes, type VisitDeps } from './book.ts';

/** The starts a service could take on `date` (the place's wall clock), with "any professional" or one. */
export async function serviceTimes(
  scope: EngineScope,
  deps: VisitDeps,
  input: {
    readonly placeId: string;
    readonly serviceId: string;
    readonly variantId: string;
    readonly staffId?: string | undefined;
    readonly date: string;
  },
): Promise<ServiceTimesView> {
  requirePermission(scope, 'services.calendar');
  const offered = await visitTimes(scope, deps, {
    placeId: checkId(input.placeId, 'That place doesn’t exist.'),
    items: [
      {
        serviceId: checkId(input.serviceId, 'That service doesn’t exist.'),
        variantId: checkId(input.variantId, 'That option doesn’t exist.'),
        ...(input.staffId === undefined ? {} : { staffId: checkId(input.staffId, 'That staff member doesn’t exist.') }),
      },
    ],
    party: 1,
    date: input.date,
  });
  return {
    times: offered.map((each) => {
      const staffId = each.items[0]?.staffId;
      return { start: each.start, end: each.end, ...(staffId === undefined ? {} : { staffId }) };
    }),
  };
}
