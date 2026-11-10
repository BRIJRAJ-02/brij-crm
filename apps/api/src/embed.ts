// What an embedded session may call (spec 0070, AC-7033): the shared modules' procedures and its own read, nothing
// else. `orpc.ts` refuses every other procedure for such a session (NOT_FOUND, as one that doesn't exist), holds each
// allowed one to the session's workspace, and asks on every call that its connection is still live with the module.
//
// Link pages is the one module today: the person's own page and its editor, and Team pages for someone who may
// manage them. Left out on purpose:
// - the choices of other modules' things to put on a page (booking pages, forms, places), which belong to modules the
//   connection doesn't share, so the frame offers no such block;
// - the workspace's brand kit's writes (Settings › Brand): an embedded admin keeps Team pages management and nothing
//   else of an admin's powers (the read stays, since a page's look starts from the kit);
// - every bootstrap procedure (`me.*`, `workspaces.*`, realtime tokens): the frame has no workspace switcher, no live
//   socket and no account.
import { contract, type PartnerModule } from '@crm/contracts';

/** What a procedure belongs to: a module the connection must have, or the embedded session's own read. */
export type EmbedReach = PartnerModule | 'session';

/**
 * Team pages procedures the frame never reaches: setting up a person's own Timefix login (spec 0070, AC-7023;
 * coordinator, 10 Nov 2026), which is Timefix's alone, so an app can't mint logins at addresses it controls.
 */
const TEAM_PAGES_LEFT_OUT: ReadonlySet<string> = new Set(['inviteLogin', 'cancelLoginInvite']);

/** The link page procedures the frame doesn't offer: other modules' choices. */
const LINK_PAGE_LEFT_OUT: ReadonlySet<string> = new Set(['pageChoices', 'formChoices', 'placeChoices']);

/** Every procedure an embedded session may call, and what it belongs to. */
export const EMBED_PROCEDURES: Readonly<Record<string, EmbedReach>> = Object.freeze({
  'embed.session': 'session',
  ...Object.fromEntries(
    Object.keys(contract.profile)
      .filter((name) => !LINK_PAGE_LEFT_OUT.has(name))
      .map((name) => [`profile.${name}`, 'link_pages' as const]),
  ),
  ...Object.fromEntries(
    Object.keys(contract.teamPages)
      .filter((name) => !TEAM_PAGES_LEFT_OUT.has(name))
      .map((name) => [`teamPages.${name}`, 'link_pages' as const]),
  ),
  'brand.get': 'link_pages',
});

/** What `path` belongs to for an embedded session, or undefined when such a session may not call it. */
export function embedReachOf(path: string): EmbedReach | undefined {
  return Object.hasOwn(EMBED_PROCEDURES, path) ? EMBED_PROCEDURES[path] : undefined;
}
