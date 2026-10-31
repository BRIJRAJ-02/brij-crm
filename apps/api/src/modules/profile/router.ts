import { linkPageCacheTags, myPicturePath } from '@crm/contracts';
import {
  archiveProfileItem,
  importProfileLinks,
  isImportableHost,
  readImportedPage,
  deleteProfileItem,
  getMyProfile,
  listProfileFormChoices,
  saveProfileTheme,
  readProfileLook,
  saveProfileAccent,
  saveProfileShareImage,
  setProfileIndexable,
  showMyLinkPage,
  listProfilePageChoices,
  orderProfileItems,
  readProfileCounts,
  readProfileItems,
  saveProfileItem,
  personPicture,
  readOwnLinkAddress,
  readQrStyle,
  saveQrStyle,
  updateMyMemberProfile,
  type ProfileExtras,
} from '@crm/core';
import { createMediaReader, readSitePicture, storeLinkPicture } from '../../link-page-pictures.ts';
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
  const picture = personPicture(user.id, user.image);
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
/** The reads one account may ask for in half an hour (AC-5528), counted here as asks and in the definer as writes. */
const IMPORTS_A_WINDOW = 3;
const HALF_HOUR = 1800;
/** The longest address `auth.link_imports.source` holds, which the encoded address must also fit. */
const IMPORT_SOURCE_MAX = 400;
/** A page of links is a few hundred kilobytes at most (AC-5525). */
const IMPORT_MAX_BYTES = 1024 * 1024;
/** Outside reads for a link page's pictures and media, per person (spec 0061, AC-6128): 30 a minute. */
const OUTSIDE_READS = { window: 60, max: 30 } as const;
/** The same site read for anyone's thumbnail: 60 a minute, so a page of links can't point us at one site's door. */
const SITE_READS = { window: 60, max: 60 } as const;

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
  items: member.profile.items.handler(({ context }) =>
    readProfileItems(context.scope, { publicOrigins: context.publicOrigins }),
  ),
  /**
   * A link to save the caller's own page to a wallet (26 October 2026). The pass holds only what their page already
   * shows — their name, the line under it and their address — and its code opens that address tagged
   * `utm_medium=<wallet>`, so a scan at an event is tellable from a shared link. Google's save link is signed for
   * the press that follows it and lasts minutes, so it is made here and never stored. With no credentials in this
   * environment the answer is `off`, and the editor offers no button.
   */
  walletLink: member.profile.walletLink.handler(async ({ context, input }) => {
    const wallet = context.walletLink(input.wallet);
    if (wallet === undefined) return { off: true as const };
    const me = await getMyProfile(context.scope);
    if (me.handle === undefined) throw apiError('NOT_FOUND', 'Pick a handle before you save your page.');
    return {
      url: wallet({ handle: me.handle, name: me.name, ...(me.bio === '' ? {} : { bio: me.bio }) }),
    };
  }),
  /** Opening the caller's own link page, or its Live or Private switch (spec 0058, AC-23). */
  show: member.profile.show.handler(async ({ context, input }) => {
    const shown = await commitWrite(context, { mutationId: input.mutationId }, () =>
      showMyLinkPage(context.scope, input.live),
    );
    // The switch, either way: the edge's copies of the page (its shell, card, picture and share image) are deleted
    // once the change has committed, so a page made Private stops being served at once and one made Live stops
    // answering its cached 404. Opening the page changes nothing a visitor was sent, so it purges nothing.
    if (input.live !== undefined) {
      const { handle } = await getMyProfile(context.scope);
      await context.edgeCache.forget(linkPageCacheTags(handle));
    }
    return shown;
  }),
  counts: member.profile.counts.handler(async ({ context, input }) => {
    const counts = await readProfileCounts(context.scope, new Date(), input.days ?? 30);
    return { ...counts, presses: [...counts.presses] };
  }),
  /**
   * "Use the site's picture" (spec 0061, AC-6101): the link's own saved address, never one in the request, read for
   * its `og:image` through the pinned outside fetch (https only, every address checked before connecting and after
   * each redirect, 3 seconds, 64 kB of page and 1 MB of picture), then kept as one of the owner's pictures. 30 reads
   * a minute per person and 60 per site. The editor saves the link with the picture's id.
   */
  fetchThumbnail: member.profile.fetchThumbnail.handler(async ({ context, input }) => {
    const address = await readOwnLinkAddress(context.scope, input.id);
    if (address === undefined) throw apiError('NOT_FOUND', 'That link isn’t on your link page any more.');
    const mine = await context.limiter.consumeRateLimit(`link-page-read:${context.user.id}`, OUTSIDE_READS);
    const site = await context.limiter.consumeRateLimit(`link-page-site:${new URL(address).hostname}`, SITE_READS);
    if (!mine.allowed || !site.allowed) throw apiError('LIMIT_REACHED', 'Try the site’s picture again in a minute.');
    return commitWrite(context, { mutationId: input.mutationId }, async () => {
      const bytes = await readSitePicture(context.linkPageFetch, address);
      if (bytes === undefined) return { none: true as const };
      const stored = await storeLinkPicture(context.files, context.scope, context.user.id, bytes, 'thumb');
      return stored.ok ? { image: stored.image, width: stored.width, height: stored.height } : { none: true as const };
    });
  }),
  qrStyle: member.profile.qrStyle.handler(({ context }) => readQrStyle(context.scope)),
  saveQrStyle: member.profile.saveQrStyle.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => saveQrStyle(context.scope, input.style)),
  ),
  pageChoices: member.profile.pageChoices.handler(async ({ context }) => [
    ...(await listProfilePageChoices(context.scope)),
  ]),
  formChoices: member.profile.formChoices.handler(async ({ context }) => [
    ...(await listProfileFormChoices(context.scope)),
  ]),
  saveTheme: member.profile.saveTheme.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => saveProfileTheme(context.scope, input.theme)),
  ),
  // The page's own accent and photos (spec 0060, AC-14): read for the Design panel, the accent saved whole. The
  // photos go up as bytes through `/api/me/link-page/{cover,ground}` (`link-page-images.ts`).
  look: member.profile.look.handler(({ context }) => readProfileLook(context.scope)),
  saveAccent: member.profile.saveAccent.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveProfileAccent(context.scope, { accent: input.accent, accentDark: input.accentDark }),
    ),
  ),
  setIndexable: member.profile.setIndexable.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => setProfileIndexable(context.scope, input.indexable)),
  ),
  /**
   * The picture a pasted link shows instead of the drawn card (spec 0055, AC-5511). The contract bounds the
   * base64's length; the service decodes it, reads the bytes for what they actually are, and writes the one
   * column through the one definer.
   */
  setShareImage: member.profile.setShareImage.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => saveProfileShareImage(context.scope, input.image)),
  ),
  /**
   * Bringing a link in bio page across (spec 0055, AC-5524 to AC-5528). Three steps, in this order and nowhere
   * else: the address must be one of the services on the allow list, the page is read through the one bounded
   * outside fetch, and what the parser makes of it is written as hidden blocks.
   *
   * The hourly limit is kept twice on purpose. The definer counts the imports an account made, which bounds what
   * is written; this counts the asks, which bounds what we fetch, since a refused parse or a page that never
   * answers writes nothing and would otherwise cost nothing to repeat. The two count differently: the definer's
   * hour slides, this one's is fixed, so a burst across a boundary can fetch twice the window's number before
   * the definer refuses the writes. Hence two half hour windows rather than one hour: the most an account can
   * make us fetch is six in an hour rather than ten, and the writes are still bounded at five by the definer.
   */
  importLinks: member.profile.importLinks.handler(async ({ context, input }) => {
    if (!URL.canParse(input.url)) throw apiError('CONFIG_INVALID', IMPORT_REFUSAL);
    const source = new URL(input.url);
    if (!isImportableHost(source)) throw apiError('CONFIG_INVALID', IMPORT_REFUSAL);
    // The address as the row will hold it: percent encoding grows what was typed, and a source past the column's
    // length would otherwise fail the write with a constraint error after the page was already fetched.
    if (source.href.length > IMPORT_SOURCE_MAX) throw apiError('CONFIG_INVALID', IMPORT_REFUSAL);
    const asked = await context.limiter.consumeRateLimit(`link-import:${context.user.id}`, {
      window: HALF_HOUR,
      max: IMPORTS_A_WINDOW,
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
      importProfileLinks(
        context.scope,
        {
          id: input.id,
          source: source.href,
          rows: page.rows,
          skipped: page.skipped,
        },
        { publicOrigins: context.publicOrigins },
      ),
    );
  }),
  saveItem: member.profile.saveItem.handler(async ({ context, input }) => {
    // A media block's title and poster are read once, on save (spec 0061, AC-6105), within the person's budget of
    // outside reads; past it, the block saves with the provider's name and no poster.
    const reads =
      input.block.kind === 'media'
        ? await context.limiter.consumeRateLimit(`link-page-read:${context.user.id}`, OUTSIDE_READS)
        : undefined;
    const readMedia =
      reads?.allowed === true
        ? createMediaReader({
            fetch: context.linkPageFetch,
            files: context.files,
            scope: context.scope,
            userId: context.user.id,
          })
        : undefined;
    return commitWrite(context, { mutationId: input.mutationId }, () =>
      saveProfileItem(
        context.scope,
        {
          id: input.id,
          block: input.block,
          ...(input.isEdit === undefined ? {} : { isEdit: input.isEdit }),
        },
        { publicOrigins: context.publicOrigins, ...(readMedia === undefined ? {} : { readMedia }) },
      ),
    );
  }),
  orderItems: member.profile.orderItems.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      orderProfileItems(context.scope, input.ids, { publicOrigins: context.publicOrigins }),
    ),
  ),
  archiveItem: member.profile.archiveItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      archiveProfileItem(
        context.scope,
        { id: input.id, archived: input.archived },
        { publicOrigins: context.publicOrigins },
      ),
    ),
  ),
  deleteItem: member.profile.deleteItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => deleteProfileItem(context.scope, input.id)),
  ),
});
