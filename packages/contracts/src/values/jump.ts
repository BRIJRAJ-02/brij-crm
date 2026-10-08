// Whether a view can jump to a row by its position (spec 0006, AC-52), the one
// rule the browser and the engine share: the browser picks a window's mode
// with it, and the engine's page check refuses a position where it says no.
// No Zod here, so the browser's records layer can import it cheaply
// (`@crm/contracts/jump`).

/** What the rule needs to know of a sort's attribute. */
export interface JumpAttribute {
  readonly type: string;
  readonly isSystem: boolean;
  readonly apiSlug: string;
}

/** The system attributes a view can jump on: their columns are indexed on the record row. */
const JUMP_SYSTEM_SLUGS: ReadonlySet<string> = new Set(['record_id', 'created_at', 'updated_at']);

/**
 * The attribute types whose stored sort key (spec 0004, `sort_keys`) answers
 * a jump with an index only count and offset. Location is stored but sorts on
 * two keys without driving, and references and members sort by a name looked
 * up at read time, so those page by cursor.
 */
export const JUMP_TYPES: ReadonlySet<string> = new Set([
  'text',
  'email',
  'domain',
  'url',
  'personal_name',
  'phone',
  'file',
  'number',
  'rating',
  'currency',
  'date',
  'timestamp',
  'interaction',
  'checkbox',
  'select',
  'status',
]);

/** Whether one attribute's sort can jump. */
export function canJumpOn(attribute: JumpAttribute): boolean {
  if (attribute.isSystem) return JUMP_SYSTEM_SLUGS.has(attribute.apiSlug);
  return JUMP_TYPES.has(attribute.type);
}

/**
 * Whether a view jumps by position (true) or pages by cursor (false): no
 * filter condition, and no sort, or one sort on a stored key kind, created
 * at, updated at or record id. An attribute `attributeOf` doesn't know pages
 * by cursor, so an unknown sort never jumps.
 */
export function canJump(
  filter: { readonly conditions: readonly unknown[] } | undefined,
  sorts: readonly { readonly attributeId: string }[] | undefined,
  attributeOf: (attributeId: string) => JumpAttribute | undefined,
): boolean {
  if (filter !== undefined && filter.conditions.length > 0) return false;
  if (sorts === undefined || sorts.length === 0) return true;
  if (sorts.length > 1) return false;
  const [only] = sorts;
  const attribute = only === undefined ? undefined : attributeOf(only.attributeId);
  return attribute !== undefined && canJumpOn(attribute);
}
