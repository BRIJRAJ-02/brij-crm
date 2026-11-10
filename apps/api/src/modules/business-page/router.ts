import {
  BUSINESS_HANDLES_PER_PERSON_DAILY,
  businessEdgeTags,
  claimBusinessHandle,
  discardBusinessPage,
  getBusinessPage,
  publishBusinessPage,
  saveBusinessPage,
  setPlaceSlug,
} from '@crm/core';
import { forgetReadAfterCommit } from '../../edge-cache.ts';
import { commitWrite } from '../../hooks.ts';
import { errorFields, log } from '../../log.ts';
import { member, type RequestContext } from '../../orpc.ts';

// The business page's editor (spec 0066, B4 lite): Settings › Business › Page. Inside a workspace, behind the member
// door; core checks `hospitality.manage` before anything is read, then the app gate. None of these change a record
// or store an outbox row (the editor holds its own copy and reads it again when opened). What guests see changes on
// Publish, a new address or a new place slug: those delete the business's copies at the edge (its own
// `business:<opaque id>`, never another business's, covers every place's answer), and Publish removes the pictures
// nothing uses any more from the store.
//
// A new address (a claim, or another business's first Publish) also counts against the person's own budget: 10 a day
// across every workspace (owner decision, 10 Nov 2026), on top of the workspace's 5, in the durable limiter keyed by
// their user id. Core spends from it only for an address nobody held before, at once and atomically, so parallel
// claims can't pass the cap together.
const b = member.businessPage;

/** A person's new business addresses: 10 a day, across every workspace. */
const PERSON_HANDLES = { window: 24 * 60 * 60, max: BUSINESS_HANDLES_PER_PERSON_DAILY } as const;

/** The durable limiter's key for a person's new business addresses. */
const personHandlesKey = (userId: string) => `business-handles:user:${userId}`;

/** The person's budget, as core spends it: one new address, answering whether it was there to spend. */
const handleBudgetOf = (context: Pick<RequestContext, 'limiter'>, userId: string) => ({
  handleBudget: {
    take: async () => (await context.limiter.consumeRateLimit(personHandlesKey(userId), PERSON_HANDLES)).allowed,
  },
});

/** The business a call names (spec 0065 H7, AC-6592): left out, core works in the first. */
const inBusiness = (input: { readonly property?: string | undefined }) =>
  input.property === undefined ? {} : { propertyId: input.property };

export const businessPageRouter = b.router({
  page: b.page.handler(({ context, input }) => getBusinessPage(context.scope, inBusiness(input))),
  claimHandle: b.claimHandle.handler(async ({ context, input }) => {
    const changed = await commitWrite(context, { mutationId: input.mutationId }, () =>
      claimBusinessHandle(
        context.scope,
        { handle: input.handle, ...inBusiness(input) },
        handleBudgetOf(context, context.user.id),
      ),
    );
    if (changed.stale) {
      await forgetReadAfterCommit(context.edgeCache, () =>
        businessEdgeTags(context.scope, { properties: [input.property] }),
      );
    }
    return changed.view;
  }),
  save: b.save.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveBusinessPage(context.scope, { draft: input.draft, ...inBusiness(input) }),
    ),
  ),
  setPlaceSlug: b.setPlaceSlug.handler(async ({ context, input }) => {
    const changed = await commitWrite(context, { mutationId: input.mutationId }, () =>
      setPlaceSlug(context.scope, { placeId: input.placeId, slug: input.slug, ...inBusiness(input) }),
    );
    await forgetReadAfterCommit(context.edgeCache, () => businessEdgeTags(context.scope, { places: [input.placeId] }));
    return changed.view;
  }),
  publish: b.publish.handler(async ({ context, input }) => {
    const published = await commitWrite(context, { mutationId: input.mutationId }, () =>
      publishBusinessPage(context.scope, inBusiness(input), handleBudgetOf(context, context.user.id)),
    );
    await forgetReadAfterCommit(context.edgeCache, () =>
      businessEdgeTags(context.scope, { properties: [input.property] }),
    );
    if (published.unusedPaths.length > 0 && context.files !== undefined) {
      // Their rows are gone already; a store that keeps a file only keeps an unreachable one, so it is logged, not thrown.
      await context.files.remove([...published.unusedPaths]).catch((error: unknown) => {
        log.warn('business_page.photos.unremoved', errorFields(error));
      });
    }
    return published.view;
  }),
  discard: b.discard.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => discardBusinessPage(context.scope, inBusiness(input))),
  ),
});
