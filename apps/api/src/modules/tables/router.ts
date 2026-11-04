import {
  businessCacheTags,
  freeTables,
  getTableSetup,
  listServiceDay,
  saveTableSetup,
  seatWalkIn,
  setReservationAlert,
  setVisitStatus,
} from '@crm/core';
import { forgetAfterCommit } from '../../edge-cache.ts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Table seating's staff side (spec 0066 B7 lite): a place's setup (rules, checklist, Publish), its Service list for
// one day, and the status moves a host makes. Inside a workspace, behind the member door; core checks the permission
// (`hospitality.manage` for the setup, Run service for the day and the moves, which reach table reservations only)
// before anything is read, then the Table seating gate. A walk in seats a party now (Run service), and a member turns
// their own new reservation emails on or off. A status move stores one `visits` change event naming the
// place, so every open Service list and floor reads its day again.
const t = member.tables;

export const tablesRouter = t.router({
  setup: t.setup.handler(({ context, input }) => getTableSetup(context.scope, { placeId: input.placeId })),
  saveSetup: t.saveSetup.handler(async ({ context, input }) => {
    const saved = await commitWrite(context, { mutationId: input.mutationId }, () =>
      saveTableSetup(context.scope, { placeId: input.placeId, rules: input.rules }, { slotCache: context.visitSlots }),
    );
    // The business page's Reserve opens or closes with the setup's online switch (spec 0066, AC-6642).
    await forgetAfterCommit(context.edgeCache, businessCacheTags(context.scope.workspaceId, [input.placeId]));
    return saved;
  }),
  day: t.day.handler(({ context, input }) =>
    listServiceDay(context.scope, { placeId: input.placeId, date: input.date }),
  ),
  setStatus: t.setStatus.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setVisitStatus(
        context.scope,
        { appointmentId: input.appointmentId, status: input.status },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  setNotify: t.setNotify.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      setReservationAlert(context.scope, { placeId: input.placeId, on: input.on }),
    ),
  ),
  freeTables: t.freeTables.handler(({ context, input }) =>
    freeTables(context.scope, { placeId: input.placeId, party: input.party }),
  ),
  walkIn: t.walkIn.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      seatWalkIn(
        context.scope,
        {
          placeId: input.placeId,
          party: input.party,
          resourceIds: input.resourceIds,
          ...(input.name === undefined ? {} : { name: input.name }),
          idempotencyKey: input.mutationId,
        },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
});
