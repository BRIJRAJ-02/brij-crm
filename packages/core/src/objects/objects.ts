// A workspace's objects (spec 0005; spec 0012 adds the settings): the sidebar
// and the object pages read the live ones in the workspace's order, settings
// reads the archived ones too, and owners and admins create, rename,
// restyle, move, archive and restore them. Every read and write goes through
// the scope the access door made.
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { ObjectSummary } from '@crm/contracts';
import { HUES, OBJECT_ICONS, toApiSlug, type AttributeType, type Hue, type ObjectIcon } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { defineObjectWithAttributes, reorderObject, setObjectArchived, updateObject } from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import type { AfterWrite } from '../engine/write.ts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { fieldLevel, objectLevel } from '../access/policy.ts';

const { objects } = schema;

const isIcon = (icon: string): icon is ObjectIcon => (OBJECT_ICONS as readonly string[]).includes(icon);
const isHue = (hue: string): hue is Hue => (HUES as readonly string[]).includes(hue);

/** What `listObjects` reads of each object. */
const SUMMARY_COLUMNS = {
  id: objects.id,
  apiSlug: objects.apiSlug,
  singularName: objects.singularName,
  pluralName: objects.pluralName,
  icon: objects.icon,
  hue: objects.hue,
  isStandard: objects.isStandard,
  standardKey: objects.standardKey,
  primaryAttributeId: objects.primaryAttributeId,
  position: objects.position,
  archivedAt: objects.archivedAt,
} as const;

/** One object row as `readObjects` reads it. */
type SummaryRow = Awaited<ReturnType<typeof readObjects>>[number];

/**
 * One row as the caller sees it, or nothing for an object they can't see
 * (spec 0009, AC-140). The engine checks an object's icon and hue when it is
 * written; a row that fails them here is a broken invariant and throws.
 */
function summaryOf(scope: EngineScope, row: SummaryRow): ObjectSummary[] {
  const access = objectLevel(scope.access, row.id);
  if (access === 'none') return [];
  const { icon, hue } = row;
  if (!isIcon(icon) || !isHue(hue)) throw new Error(`Object ${row.id} has an icon or hue outside the curated sets.`);
  const primaryAttributeId = row.primaryAttributeId ?? undefined;
  return [
    {
      id: row.id,
      apiSlug: row.apiSlug,
      singularName: row.singularName,
      pluralName: row.pluralName,
      access,
      icon,
      hue,
      position: row.position,
      isStandard: row.isStandard,
      isArchived: row.archivedAt !== null,
      ...(row.standardKey === null ? {} : { standardKey: row.standardKey }),
      // A name attribute the caller can't see is left out, id and all (AC-141).
      ...(primaryAttributeId === undefined ||
      fieldLevel(scope.access, { id: primaryAttributeId, objectId: row.id }) === 'hidden'
        ? {}
        : { primaryAttributeId }),
    },
  ];
}

/** The workspace's objects in its order, the archived ones too when asked, inside a transaction. */
function readObjects(tx: WorkspaceTx, scope: EngineScope, includeArchived: boolean) {
  return (
    tx
      .select(SUMMARY_COLUMNS)
      .from(objects)
      // Row level security keeps the read to this workspace; the filter says so too (house style).
      .where(
        includeArchived
          ? eq(objects.workspaceId, scope.workspaceId)
          : and(eq(objects.workspaceId, scope.workspaceId), isNull(objects.archivedAt)),
      )
      .orderBy(asc(objects.position), asc(objects.createdAt), asc(objects.id))
  );
}

/**
 * The workspace's live (unarchived) objects in its order (`position`, the
 * sidebar's; spec 0012, AC-225), and with `includeArchived` the archived
 * ones too (settings), each with what the caller may do with its records
 * (spec 0009, AC-140): an object they can't see is left out.
 */
export async function listObjects(
  scope: EngineScope,
  options: { readonly includeArchived?: boolean } = {},
): Promise<ObjectSummary[]> {
  const rows = await inWorkspace(scope, (tx) => readObjects(tx, scope, options.includeArchived === true));
  return rows.flatMap((row) => summaryOf(scope, row));
}

/** One object as the caller sees it, archived or not, or `NOT_FOUND`. */
async function readObject(scope: EngineScope, objectId: string): Promise<ObjectSummary> {
  const [row] = await inWorkspace(scope, (tx) =>
    tx
      .select(SUMMARY_COLUMNS)
      .from(objects)
      .where(and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId))),
  );
  const [summary] = row === undefined ? [] : summaryOf(scope, row);
  if (summary === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
  return summary;
}

/** A new object, as settings sends it (spec 0012, AC-223). */
export interface CreateObjectInput {
  /** The UUID v7 the browser minted: the retry key (AC-244). */
  readonly id: string;
  readonly singularName: string;
  readonly pluralName: string;
  /** Derived from the plural name (`toApiSlug`) when absent. */
  readonly apiSlug?: string | undefined;
  readonly icon: string;
  readonly hue: string;
  /** First attributes beside Name, in order, made in the same transaction (the title's API name is derived). */
  readonly attributes?: readonly { readonly title: string; readonly type: AttributeType }[] | undefined;
}

/**
 * Creates a custom object at the end of the workspace's order, with the
 * five system attributes and a text "Name" as its primary attribute (AC-223),
 * and answers it. Its API name is the one given, else `toApiSlug` of the
 * plural name. The same create again (same id, same actor) answers the
 * object already made and writes nothing (AC-244). Refuses `FORBIDDEN`
 * without `schema.manage`, `SLUG_TAKEN` and `CONFIG_INVALID` on their field,
 * `NAME_TAKEN` on the name it names, `LIMIT_REACHED` and `ID_TAKEN`.
 */
export async function createObject(
  scope: EngineScope,
  input: CreateObjectInput,
  hooks: readonly AfterWrite[] = [],
): Promise<ObjectSummary> {
  requirePermission(scope, 'schema.manage');
  const apiSlug = input.apiSlug ?? toApiSlug(input.pluralName, 'object');
  const made = await defineObjectWithAttributes(
    scope,
    {
      id: input.id,
      apiSlug,
      singularName: input.singularName,
      pluralName: input.pluralName,
      icon: input.icon,
      hue: input.hue,
    },
    (input.attributes ?? []).map((attribute) => {
      const title = attribute.title.trim();
      return { title, type: attribute.type, apiSlug: toApiSlug(title, 'attribute') };
    }),
    hooks,
  );
  return readObject(scope, made.objectId);
}

/**
 * What settings may change on an object: its names and its look (AC-224), and
 * the attribute that names its records (late trap #15). Its API name never changes.
 */
export interface EditObjectInput {
  readonly objectId: string;
  readonly singularName?: string | undefined;
  readonly pluralName?: string | undefined;
  readonly icon?: string | undefined;
  readonly hue?: string | undefined;
  readonly primaryAttributeId?: string | undefined;
}

/**
 * Renames or restyles an object, standard or custom alike (AC-224), or names
 * a custom object's records by another of its attributes (late trap #15), and
 * answers it. Refuses `FORBIDDEN`, `NOT_FOUND`, `NAME_TAKEN` on the name it
 * names and `CONFIG_INVALID` on its field.
 */
export async function editObject(
  scope: EngineScope,
  input: EditObjectInput,
  hooks: readonly AfterWrite[] = [],
): Promise<ObjectSummary> {
  requirePermission(scope, 'schema.manage');
  const objectId = checkId(input.objectId, 'That object does not exist.');
  await updateObject(
    scope,
    {
      objectId,
      ...(input.singularName === undefined ? {} : { singularName: input.singularName }),
      ...(input.pluralName === undefined ? {} : { pluralName: input.pluralName }),
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.hue === undefined ? {} : { hue: input.hue }),
      ...(input.primaryAttributeId === undefined ? {} : { primaryAttributeId: input.primaryAttributeId }),
    },
    hooks,
  );
  return readObject(scope, objectId);
}

/**
 * Moves an object to `position` in the workspace's order (AC-225), every
 * member's sidebar, and answers every object (archived ones too) in the new
 * order.
 */
export async function moveObject(
  scope: EngineScope,
  input: { readonly objectId: string; readonly position: number },
  hooks: readonly AfterWrite[] = [],
): Promise<ObjectSummary[]> {
  requirePermission(scope, 'schema.manage');
  await reorderObject(scope, { objectId: input.objectId, position: input.position }, hooks);
  return listObjects(scope, { includeArchived: true });
}

/**
 * Archives an object, standard ones included (AC-226): it leaves the
 * sidebar, pickers and create flows; its records, values and history stay.
 * Answers it.
 */
export async function archiveObject(
  scope: EngineScope,
  input: { readonly objectId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<ObjectSummary> {
  requirePermission(scope, 'schema.manage');
  const objectId = checkId(input.objectId, 'That object does not exist.');
  await setObjectArchived(scope, { objectId, archived: true }, hooks);
  return readObject(scope, objectId);
}

/** Restores an archived object (AC-226): all of it comes back unchanged, at its old place. Answers it. */
export async function restoreObject(
  scope: EngineScope,
  input: { readonly objectId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<ObjectSummary> {
  requirePermission(scope, 'schema.manage');
  const objectId = checkId(input.objectId, 'That object does not exist.');
  await setObjectArchived(scope, { objectId, archived: false }, hooks);
  return readObject(scope, objectId);
}
