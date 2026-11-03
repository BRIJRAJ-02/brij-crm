import { getTableSetup, listServiceDay, saveTableSetup, setVisitStatus } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Table seating's staff side (spec 0066 B7 lite): a place's setup (rules, checklist, Publish), its Service list for
// one day, and the status moves a host makes. Inside a workspace, behind the member door; core checks the permission
// (`hospitality.manage` for the setup, Run service for the day and the moves, which reach table reservations only)
// before anything is read, then the Table seating gate. A status move stores one `visits` change event naming the
// place, so every open Service list and floor reads its day again.
const t = member.tables;

export const tablesRouter = t.router({
  setup: t.setup.handler(({ context, input }) => getTableSetup(context.scope, { placeId: input.placeId })),
  saveSetup: t.saveSetup.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveTableSetup(context.scope, { placeId: input.placeId, rules: input.rules }, { slotCache: context.visitSlots }),
    ),
  ),
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
});
