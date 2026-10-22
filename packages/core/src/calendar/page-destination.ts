// A booking page's own "Add events to" (spec 0024 milestone 5, AC-997): one
// of the page owner's calendars they can write, or none (the owner's own
// destination). Read and changed by whoever may change the page (its owner
// with `booking.manage`, anyone with `booking.admin`, the rule `pages.ts`
// keeps), but the calendar must be the owner's, and what a reader learns is
// its id and whether bookings can go there: a colleague never reads its name
// (spec 0037, AC-1307's rule). The owner reads the names from their own
// `calendar.calendars.list`.
//
// When the page's calendar can't take bookings (the member can only read it
// now, or its account stopped), bookings go to the owner's own destination,
// and `status` says why so the editor can (`createEvent`'s `destinationFor`
// applies the same rule). A calendar that goes (removed at the provider, or its
// account disconnected or revoked) clears the page's choice by its foreign key,
// and the page follows the owner again; the trigger in 0085 keeps the gone
// calendar's name (`destination_removed_name`), so the page reads `unusable`
// and its owner learns which calendar stopped until they set the page again.
// Free and busy never reads the page's calendar: a page is held back by its
// owner's conflict calendars and their own destination's account (`freeBusy`),
// so a stopped page calendar never closes it either.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { NOT_WRITABLE } from './calendars.ts';

/** What a page the reader can't change, or that doesn't exist, answers. */
const UNKNOWN_PAGE = 'That booking page doesn’t exist, or isn’t yours.';

/** What a calendar that isn't the page owner's answers. */
const NOT_OWNERS = 'Pick one of the page owner’s calendars.';

/**
 * Where a page's bookings go: `default` (the owner's own destination), `page` (the calendar it names), or
 * `unusable` (it names one that can't take bookings now, or the one it named went, so they go to the owner's default).
 */
export interface PageDestination {
  readonly calendarId?: string;
  readonly status: 'default' | 'page' | 'unusable';
  /** The reader owns the page: their own calendars are the choices. */
  readonly isOwner: boolean;
  /** The page's calendar went (removed or disconnected): its name, for the owner only. */
  readonly removedName?: string;
}

interface PageRow extends Record<string, unknown> {
  readonly owner_member_id: string;
  readonly destination_calendar_id: string | null;
  readonly usable: boolean | null;
  readonly removed_name: string | null;
}

/** The page, live and the reader's to change, with its destination and whether it can take bookings. */
function pageFor(scope: EngineScope, pageIdAsGiven: string, lock: boolean) {
  requirePermission(scope, 'booking.manage');
  const pageId = checkId(pageIdAsGiven, UNKNOWN_PAGE);
  const member = scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
  return {
    pageId,
    member,
    read: (tx: WorkspaceTx) =>
      tx
        .execute<PageRow>(
          sql`
          select p.owner_member_id::text as owner_member_id, p.destination_calendar_id::text as destination_calendar_id,
            (k.access_role in ('owner', 'writer') and c.status in ('syncing', 'connected', 'failed')
              and k.member_id = p.owner_member_id) as usable,
            p.destination_removed_name as removed_name
          from booking_pages p
          left join calendar_calendars k on k.workspace_id = p.workspace_id and k.id = p.destination_calendar_id
          left join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
          where p.id = ${pageId}::uuid and p.deleted_at is null
          ${lock ? sql`for no key update of p` : sql``}
        `,
        )
        .then((found) => {
          const [row] = found.rows;
          if (row === undefined || !(can(scope.access, 'booking.admin') || row.owner_member_id === member)) {
            throw refuse('NOT_FOUND', UNKNOWN_PAGE);
          }
          return row;
        }),
  };
}

const viewOf = (row: PageRow, member: string | undefined): PageDestination => {
  const isOwner = row.owner_member_id === member;
  if (row.destination_calendar_id === null) {
    // A colleague learns the page fell back, never the gone calendar's name (spec 0037, AC-1307's rule).
    if (row.removed_name === null) return { status: 'default', isOwner };
    return { status: 'unusable', isOwner, ...(isOwner ? { removedName: row.removed_name } : {}) };
  }
  return { calendarId: row.destination_calendar_id, status: row.usable === true ? 'page' : 'unusable', isOwner };
};

/** A page's own "Add events to" (AC-997). */
export async function readPageDestination(
  scope: EngineScope,
  input: { readonly pageId: string },
): Promise<PageDestination> {
  const page = pageFor(scope, input.pageId, false);
  return inWorkspace(scope, async (tx) => viewOf(await page.read(tx), page.member));
}

/**
 * Sets a page's own "Add events to" (AC-997): one of the page owner's calendars they can write, or `null` for the
 * owner's own destination. A new choice applies to new bookings only (AC-996).
 */
export async function setPageDestination(
  scope: EngineScope,
  input: { readonly pageId: string; readonly calendarId: string | null },
  hooks: readonly AfterWrite[] = [],
): Promise<PageDestination> {
  const page = pageFor(scope, input.pageId, true);
  // A write like any other (its mutation id, the after write hooks), so an admin changing a colleague's page is kept.
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const row = await page.read(tx);
      const calendarId = input.calendarId === null ? null : checkId(input.calendarId, NOT_OWNERS);
      if (calendarId !== null) {
        const found = await tx.execute<{ writable: boolean }>(sql`
        select (k.access_role in ('owner', 'writer') and c.status in ('syncing', 'connected', 'failed')) as writable
        from calendar_calendars k
        join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
        where k.id = ${calendarId}::uuid and k.member_id = ${row.owner_member_id}::uuid
      `);
        const [calendar] = found.rows;
        if (calendar === undefined) throw refuse('NOT_FOUND', NOT_OWNERS);
        if (!calendar.writable) throw refuse('CALENDAR_NOT_WRITABLE', NOT_WRITABLE);
      }
      const by = actorRow(scope.actor);
      await tx.execute(sql`
      update booking_pages set destination_calendar_id = ${calendarId}::uuid, destination_removed_name = null,
        updated_at = now(),
        updated_by_type = ${by.type}::actor_type, updated_by_id = ${by.id}::uuid,
        updated_by_member_id = ${by.memberId}::uuid
      where id = ${page.pageId}::uuid
    `);
      return viewOf(await page.read(tx), page.member);
    },
    hooks,
  );
  return result;
}
