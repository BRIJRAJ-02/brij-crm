// Whether an address on one of our own public origins stays inside a workspace (spec 0056, AC-5610 to AC-5612). The
// one function a link block, a form's redirect and a routing rule's redirect all ask, so they cannot disagree: the
// address is parsed by `parseWorkspaceAddress` in `@crm/contracts`, and resolved here through the rows the caller's
// own workspace can see (row level security) and the handle definers, which answer only a person who is still an
// active member. A page of another workspace and a page that does not exist read the same: the answer never says
// which, so a refusal cannot be used to find out whether another workspace holds a page.
import { parseWorkspaceAddress, WORKSPACE_ADDRESS_REFUSAL } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

const { bookingPages, forms } = schema;

interface OwnerRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly workspace_id: string;
}

interface PageRow extends Record<string, unknown> {
  readonly page_id: string;
}

/**
 * The refusal sentence when `address` names a page of our own that is not in `workspaceId`, else undefined: an
 * address on any other site, or one that names no page of ours, is not this function's to refuse. `tx` must be a
 * transaction of that workspace, so a booking page or a form is found only inside it. `origins` are our own public
 * origins; with none given nothing is a workspace address (the caller always passes the deployment's).
 */
export async function workspaceAddressProblem(
  tx: WorkspaceTx,
  workspaceId: string,
  address: string,
  origins: readonly string[],
): Promise<string | undefined> {
  const named = parseWorkspaceAddress(address, origins);
  if (named === undefined) return undefined;
  const found = await resolves(tx, workspaceId, named);
  return found ? undefined : WORKSPACE_ADDRESS_REFUSAL;
}

/** Whether the page `named` is in `workspaceId`. */
async function resolves(
  tx: WorkspaceTx,
  workspaceId: string,
  named: NonNullable<ReturnType<typeof parseWorkspaceAddress>>,
): Promise<boolean> {
  if (named.kind === 'booking_key') {
    const [row] = await tx
      .select({ id: bookingPages.id })
      .from(bookingPages)
      .where(
        and(
          eq(bookingPages.publicKey, named.key),
          eq(bookingPages.workspaceId, workspaceId),
          isNull(bookingPages.deletedAt),
        ),
      );
    return row !== undefined;
  }
  if (named.kind === 'form_key') {
    const [row] = await tx
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.publicKey, named.key), eq(forms.workspaceId, workspaceId), isNull(forms.archivedAt)));
    return row !== undefined;
  }
  // A handle names one membership: its workspace must be this one, and the person still an active member there.
  const owners = await tx.execute<OwnerRow>(
    sql`select user_id::text as user_id, workspace_id::text as workspace_id from crm_handle_owner(${named.handle})`,
  );
  const [owner] = owners.rows;
  if (owner === undefined || owner.workspace_id !== workspaceId) return false;
  if (named.kind === 'handle') return true;
  const pages = await tx.execute<PageRow>(
    sql`select page_id::text as page_id from crm_booking_page_by_address(${owner.user_id}::uuid, ${workspaceId}::uuid, ${named.slug})`,
  );
  return pages.rows.length > 0;
}
