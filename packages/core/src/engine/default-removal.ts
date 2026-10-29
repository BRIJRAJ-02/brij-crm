// A removed member in a field's default (late trap #70): settings checks a static Member default names an active
// member when it is set, and a create reads the default with the members no longer here left out
// (`liveMemberDefault`). The removal takes them out of the stored default too, so settings shows what a create
// gives, and the remove dialog counts the fields beforehand: a required one left naming nobody needs a value on
// every new record, a form's and a booking's included, until someone gives it a new default.
import { and, eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { RemovalEffect } from '../members/removal-effect.ts';
import { touched } from './definitions.ts';
import type { WriteContext } from './write.ts';

const { attributes } = schema;

/** A static Member default's members, as stored: one `{ type, id }` or a list of them. */
type Named = { readonly type?: unknown; readonly id?: unknown };

/** Whether one stored item names this member. */
const names = (item: unknown, memberId: string): boolean =>
  typeof item === 'object' &&
  item !== null &&
  String((item as Named).type).toLowerCase() === 'member' &&
  typeof (item as Named).id === 'string' &&
  String((item as Named).id).toLowerCase() === memberId.toLowerCase();

/** The attributes whose static Member default names `memberId`, with that default: live ones, or archived too. */
async function defaultsNaming(tx: WorkspaceTx, workspaceId: string, memberId: string, withArchived = false) {
  // The jsonb containment test finds both shapes: the member alone, or the member in a list.
  const member = JSON.stringify({ type: 'member', id: memberId.toLowerCase() });
  const found = await tx.execute<{
    id: string;
    object_id: string | null;
    list_id: string | null;
    is_required: boolean;
    value: unknown;
  }>(sql`
    select id::text, object_id::text, list_id::text, is_required, default_value -> 'value' as value
    from attributes
    where workspace_id = ${workspaceId}::uuid and type = 'actor_reference'
      ${withArchived ? sql`` : sql`and archived_at is null`}
      and default_value ->> 'kind' = 'static'
      and (lower((default_value -> 'value')::text)::jsonb @> ${member}::jsonb
        or lower((default_value -> 'value')::text)::jsonb @> ${`[${member}]`}::jsonb)
  `);
  return found.rows;
}

/** The fields whose default names a member being removed: counted for the dialog, then cleared of them. */
export const defaultsRemoval: RemovalEffect = {
  feature: 'attribute defaults',
  constraints: [],
  count: async (tx, workspaceId, memberId) => {
    const rows = await defaultsNaming(tx, workspaceId, memberId);
    // Required ones left naming nobody: a list default keeping another member still fills.
    const emptied = rows.filter((row) => !Array.isArray(row.value) || row.value.every((item) => names(item, memberId)));
    return {
      defaults: rows.length,
      requiredDefaults: emptied.filter((row) => row.is_required).length,
    };
  },
  run: async (context: WriteContext, memberId: string) => {
    const { tx, scope } = context;
    // Archived ones too, so one restored later never shows a member who has left.
    const rows = await defaultsNaming(tx, scope.workspaceId, memberId, true);
    for (const row of rows) {
      const kept = Array.isArray(row.value) ? row.value.filter((item) => !names(item, memberId)) : [];
      const next = Array.isArray(row.value) && kept.length > 0 ? { kind: 'static', value: kept } : null;
      await tx
        .update(attributes)
        .set({ defaultValue: next, ...touched(scope) })
        .where(and(eq(attributes.workspaceId, scope.workspaceId), eq(attributes.id, row.id)));
      // Every open screen reads the field's settings again, as after any attribute edit.
      const parent =
        row.object_id !== null ? { objectId: row.object_id } : row.list_id !== null ? { listId: row.list_id } : {};
      context.record({ definitions: [{ ...parent, attributeIds: [row.id] }] });
    }
  },
};
