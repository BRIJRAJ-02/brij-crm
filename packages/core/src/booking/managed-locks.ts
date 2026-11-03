// A managed page's locks (spec 0037, AC-1334), on their own so the page editor can ask about them without reaching
// the managed pages service, which reads pages: the lock check and the propagation would otherwise import each
// other. A locked part is the workspace's; a member's write to one is refused here, on the server, whatever their
// editor shows them.
import { and, eq, isNull } from 'drizzle-orm';
import { MANAGED_PART_KEYS, MANAGED_PARTS, type BookingPageSettings, type ManagedPart } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';

const { bookingPages } = schema;

/** What a member's write to a part their workspace locked is refused with (AC-1334). */
export const LOCKED_PART_REFUSAL = 'Your workspace sets this part of the page.';

/** What a member's editor shows beside a locked part of their page (AC-1334). */
export const LOCKED_BY_WORKSPACE = 'Set by your workspace';

/** The locked parts stored on a template row, as `ManagedPart`s; a stray stored value reads as nothing. */
export function locksOf(row: { readonly locked: readonly string[] | null }): readonly ManagedPart[] {
  const known = new Set<string>(MANAGED_PARTS);
  return (row.locked ?? []).filter((part): part is ManagedPart => known.has(part));
}

/**
 * The part of `settings` a member may not write, given the locks their template holds (AC-1334), or undefined when
 * every key they sent is theirs. The key named is the first locked one, so the refusal points at a field.
 */
export function lockedPartOfWrite(
  locked: readonly ManagedPart[],
  settings: Partial<BookingPageSettings>,
): { readonly part: ManagedPart; readonly key: keyof BookingPageSettings } | undefined {
  for (const part of locked) {
    for (const key of MANAGED_PART_KEYS[part]) {
      if (settings[key] !== undefined) return { part, key };
    }
  }
  return undefined;
}

/** The locks the template a page was made from holds; undefined for a page made from no template. */
export async function templateLocksOf(
  tx: WorkspaceTx,
  templateId: string | null,
): Promise<readonly ManagedPart[] | undefined> {
  if (templateId === null) return undefined;
  const [row] = await tx
    .select({ locked: bookingPages.locked })
    .from(bookingPages)
    .where(and(eq(bookingPages.id, templateId), isNull(bookingPages.deletedAt)));
  return row === undefined ? undefined : locksOf(row);
}
