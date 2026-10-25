import { myPicturePath } from '@crm/contracts';
import {
  archiveProfileItem,
  importProfileLinks,
  isImportableHost,
  readImportedPage,
  deleteProfileItem,
  getMyProfile,
  listProfileFormChoices,
  saveProfileTheme,
  setProfileIndexable,
  listProfilePageChoices,
  orderProfileItems,
  readProfileCounts,
  readProfileItems,
  saveProfileItem,
  servedPicture,
  updateMyMemberProfile,
  type ProfileExtras,
} from '@crm/core';
import { apiError } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { member, type RequestContext, type SessionContext } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

/**
 * What only the session knows: the account picture as our own origin serves it (`/api/me/picture?v=`), when it is
 * one of Google's, and whether Google is linked (for Sync Google photo), where Google sign in is on.
 */
async function extrasOf(context: RequestContext & SessionContext): Promise<ProfileExtras> {
  const { user } = context;
  const picture = servedPicture(user.id, user.image);
  const google = context.auth.providers.google
    ? (await context.googleLinked(user.id))
      ? 'linked'
      : 'unlinked'
    : undefined;
  return {
    ...(picture === undefined ? {} : { image: myPicturePath(picture.version) }),
    ...(google === undefined ? {} : { google }),
  };
}

/** Only a link in bio page is ever fetched (AC-5524), and the sentence says which kind of address to give. */
const IMPORT_REFUSAL = 'We can only bring links across from a link in bio page.';
/** The page answered nothing we could read: a 404, a redirect away, something that isn't a page, or too slow. */
const IMPORT_UNREAD = 'We couldn’t read that page. Check the address, and that the page is public.';
/** Past the hourly limit. It names no number a person would have to count against. */
const IMPORT_SPENT = 'You’ve brought across a few pages just now. Try again in a little while.';
/** The imports one account may ask for in an hour (AC-5528), counted here as asks and in the definer as imports. */
const IMPORTS_AN_HOUR = 5;
const HOUR = 3600;
/** A page of links is a few hundred kilobytes at most (AC-5525). */
const IMPORT_MAX_BYTES = 1024 * 1024;

// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own member row, behind the member door.
export const profileRouter = member.profile.router({
  get: member.profile.get.handler(async ({ context }) => getMyProfile(context.scope, await extrasOf(context))),
  update: member.profile.update.handler(async ({ context, input }) => {
    const extras = await extrasOf(context);
    return commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateMyMemberProfile(
        context.scope,
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          ...(input.handle === undefined ? {} : { handle: input.handle }),
          ...(input.bio === undefined ? {} : { bio: input.bio }),
          ...(input.pictureHidden === undefined ? {} : { pictureHidden: input.pictureHidden }),
          ...(input.socials === undefined ? {} : { socials: input.socials }),
        },
        extras,
        hooks,
        sourceOf(context),
      ),
    );
  }),
  // The link page (spec 0051): the caller's own blocks, in every workspace the same, never another person's.
  items: member.profile.items.handler(({ context }) => readProfileItems(context.scope)),
  counts: member.profile.counts.handler(async ({ context }) => {
    const counts = await readProfileCounts(context.scope);
    return { ...counts, presses: [...counts.presses] };
  }),
  pageChoices: member.profile.pageChoices.handler(async ({ context }) => [
    ...(await listProfilePageChoices(context.scope)),
  ]),
  formChoices: member.profile.formChoices.handler(async ({ context }) => [
    ...(await listProfileFormChoices(context.scope)),
  ]),
  saveTheme: member.profile.saveTheme.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => saveProfileTheme(context.scope, input.theme)),
  ),
  setIndexable: member.profile.setIndexable.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => setProfileIndexable(context.scope, input.indexable)),
  ),
  /**
   * Bringing a link in bio page across (spec 0055, AC-5524 to AC-5528). Three steps, in this order and nowhere
   * else: the address must be one of the services on the allow list, the page is read through the one bounded
   * outside fetch, and what the parser makes of it is written as hidden blocks.
   *
   * The hourly limit is kept twice on purpose. The definer counts the imports an account made, which bounds what
   * is written; this counts the asks, which bounds what we fetch, since a refused parse or a page that never
   * answers writes nothing and would otherwise cost nothing to repeat.
   */
  importLinks: member.profile.importLinks.handler(async ({ context, input }) => {
    if (!URL.canParse(input.url)) throw apiError('CONFIG_INVALID', IMPORT_REFUSAL);
    const source = new URL(input.url);
    if (!isImportableHost(source)) throw apiError('CONFIG_INVALID', IMPORT_REFUSAL);
    const asked = await context.limiter.consumeRateLimit(`link-import:${context.user.id}`, {
      window: HOUR,
      max: IMPORTS_AN_HOUR,
    });
    if (!asked.allowed) throw apiError('LIMIT_REACHED', IMPORT_SPENT);
    const fetched = await context.outsideFetch(source, {
      accept: ['text/html', 'application/xhtml+xml'],
      maxBytes: IMPORT_MAX_BYTES,
      allow: isImportableHost,
    });
    if (!fetched.ok) throw apiError('CONFIG_INVALID', IMPORT_UNREAD);
    const page = readImportedPage(new TextDecoder().decode(fetched.bytes), source);
    return commitWrite(context, { mutationId: input.mutationId }, () =>
      importProfileLinks(context.scope, {
        id: input.id,
        source: source.href,
        rows: page.rows,
        skipped: page.skipped,
      }),
    );
  }),
  saveItem: member.profile.saveItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveProfileItem(context.scope, {
        id: input.id,
        block: input.block,
        ...(input.isEdit === undefined ? {} : { isEdit: input.isEdit }),
      }),
    ),
  ),
  orderItems: member.profile.orderItems.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => orderProfileItems(context.scope, input.ids)),
  ),
  archiveItem: member.profile.archiveItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      archiveProfileItem(context.scope, { id: input.id, archived: input.archived }),
    ),
  ),
  deleteItem: member.profile.deleteItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => deleteProfileItem(context.scope, input.id)),
  ),
});
