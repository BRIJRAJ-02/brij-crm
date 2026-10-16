// Each object's default view (spec 0020, AC-462): "All <plural name>",
// shared, seeded by the system, listing every non system attribute in
// attribute order then Created at (an empty column list that shows new
// attributes), one pinned column, newest first. Written in the same
// transaction as the object, by `insertObject`, so the workspace template, a
// custom object and the migration's backfill all leave an object with one.
import { eq } from 'drizzle-orm';
import type { ViewConfig } from '@crm/contracts';
import { schema } from '@crm/db';
import type { WriteContext } from '../engine/write.ts';

const { objects, views } = schema;

/** The longest view name. */
export const MAX_VIEW_NAME = 100;

/** The default view's name for an object: "All <plural name>", cut to 100 characters. */
export function defaultViewName(pluralName: string): string {
  return `All ${pluralName.trim()}`.slice(0, MAX_VIEW_NAME).trim();
}

/** The default config: every attribute shown as settings orders them, one pinned, newest first. */
export function defaultViewConfig(createdAtId: string | undefined): ViewConfig {
  return {
    columns: [],
    showNewAttributes: true,
    pinnedCount: 1,
    sorts: createdAtId === undefined ? [] : [{ attributeId: createdAtId, direction: 'descending' }],
  };
}

/**
 * Seeds an object's default view and points the object at it, inside the
 * object's own write. The system seeds it (no creator), whoever made the
 * object, so no member can make it private. No `views` event: nobody holds
 * the views of an object that didn't exist, and the object's own
 * `definitions` event reaches every screen.
 */
export async function seedDefaultView(
  context: Pick<WriteContext, 'tx' | 'scope'>,
  object: { readonly objectId: string; readonly pluralName: string; readonly createdAtId: string | undefined },
): Promise<string> {
  const { tx, scope } = context;
  const [view] = await tx
    .insert(views)
    .values({
      workspaceId: scope.workspaceId,
      objectId: object.objectId,
      name: defaultViewName(object.pluralName),
      visibility: 'workspace',
      position: 0,
      config: defaultViewConfig(object.createdAtId),
      createdByType: 'system',
      updatedByType: 'system',
    })
    .returning({ id: views.id });
  if (view === undefined) throw new Error('The default view was not created.');
  await tx.update(objects).set({ defaultViewId: view.id }).where(eq(objects.id, object.objectId));
  return view.id;
}
