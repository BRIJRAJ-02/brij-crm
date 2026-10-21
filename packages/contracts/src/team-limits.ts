// The team's limits (spec 0031), as plain TypeScript with no Zod, so the
// browser's data layer and the Members page read them without the schema
// library. `members.ts` and `team.ts` re-export them with the schemas.

/** Addresses one invite may name (AC-803). */
export const INVITE_BATCH_MAX = 20;

/** Members one page holds unless the caller asks for fewer (the Members page's page, AC-810). */
export const MEMBERS_PAGE = 100;

/** The most members one page may hold: the data layer reads every member this many at a time. */
export const MEMBERS_PAGE_MAX = 500;

/** The longest search the Members page sends. */
export const MEMBER_SEARCH_MAX = 100;

/** How long an invite link may work (AC-818), in days from when it is set; no expiry is the default. */
export const INVITE_LINK_DAYS = [1, 7, 30] as const;
/** One of the invite link's expiries, in days. */
export type InviteLinkDays = (typeof INVITE_LINK_DAYS)[number];

/** The most people one invite link may let in, when it is capped (AC-818). */
export const INVITE_LINK_USES_MAX = 1000;

/** How long a deleted workspace waits before its purge, while an owner can restore it (spec 0031, AC-823). */
export const WORKSPACE_PURGE_DAYS = 30;

/**
 * Whether what an owner typed names the workspace (spec 0031, AC-823): curly
 * quotes and apostrophes count as straight ones and runs of space as one, so
 * "Ada's workspace" typed on a keyboard matches "Ada’s workspace". Case
 * stays strict.
 */
export function namesMatch(typed: string, name: string): boolean {
  const plain = (text: string) =>
    text
      .replace(/[‘’‛′]/g, "'")
      .replace(/[“”‟″]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  return plain(typed) === plain(name);
}
