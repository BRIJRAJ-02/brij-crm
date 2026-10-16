// The Trash screen's pure parts (spec 0022, AC-533, AC-534): its synthetic
// columns, what each cell shows, whether Restore may run, and the restore
// toast. Kept apart from the screen, so the node tests cover them.
import type {
  ActorDisplay,
  FieldAttributeShape,
  MemberSummary,
  ObjectSummary,
  RestoreSummary,
  TrashRow,
} from '@crm/data';
import type { ToastContent } from '@crm/ui';
import { strings } from './strings.ts';

/** The trash's columns, by id: Name (the row header), Object, Deleted by, Deleted, Removed after. */
export const TRASH_COLUMNS = {
  name: 'name',
  object: 'object',
  deletedBy: 'deleted_by',
  deletedAt: 'deleted_at',
  expiresAt: 'expires_at',
} as const;

/** One synthetic column as the field set reads it, read only with the trash's reason ("Restore it to change it."). */
function column(id: string, name: string, type: FieldAttributeShape['type']): FieldAttributeShape {
  return {
    id,
    name,
    type,
    allowMultiple: false,
    isRequired: false,
    isUnique: false,
    isReadOnly: true,
    readOnlyReason: strings.readOnly,
    ...(type === 'record_reference' ? { cardinality: 'one' as const } : {}),
  };
}

/** The columns' attributes, so each value draws through its one field design. */
export const TRASH_ATTRIBUTES: readonly FieldAttributeShape[] = [
  column(TRASH_COLUMNS.name, strings.columns.name, 'record_reference'),
  column(TRASH_COLUMNS.object, strings.columns.object, 'text'),
  column(TRASH_COLUMNS.deletedBy, strings.columns.deletedBy, 'actor_reference'),
  column(TRASH_COLUMNS.deletedAt, strings.columns.deletedAt, 'timestamp'),
  column(TRASH_COLUMNS.expiresAt, strings.columns.expiresAt, 'date'),
];

/** An object's name in the Object column: its plural, "(archived)" after an archived one. */
export function objectLabel(object: ObjectSummary | undefined): string {
  if (object === undefined) return '';
  return object.isArchived ? strings.archived(object.pluralName) : object.pluralName;
}

/** A day as `YYYY-MM-DD` in `timeZone` (the date field's value), from one formatter made once per zone. */
export function dayFormatter(timeZone: string): (iso: string) => string {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (iso) => {
    const parts = format.formatToParts(new Date(iso));
    const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
}

/** A day as `YYYY-MM-DD` in `timeZone`: when the daily cleanup removes the record. */
export function dayIn(iso: string, timeZone: string): string {
  return dayFormatter(timeZone)(iso);
}

/** What one cell of the trash holds, in its type's value shape. */
export function cellValue(
  row: TrashRow,
  columnId: string,
  objects: ReadonlyMap<string, ObjectSummary>,
  dayOf: (iso: string) => string,
): unknown {
  const { item } = row;
  switch (columnId) {
    case TRASH_COLUMNS.name:
      return { objectId: item.objectId, recordId: item.recordId };
    case TRASH_COLUMNS.object:
      return objectLabel(objects.get(item.objectId));
    case TRASH_COLUMNS.deletedBy:
      return item.deletedBy;
    case TRASH_COLUMNS.deletedAt:
      return item.deletedAt;
    case TRASH_COLUMNS.expiresAt:
      return dayOf(item.expiresAt);
    default:
      return null;
  }
}

/**
 * Who deleted a record, as the Deleted by cell names them: a member by name
 * ("Someone removed from this workspace" once they left), "The system", "An
 * API key" or "An automation".
 */
export function deletedBy(row: TrashRow, members: readonly MemberSummary[]): ActorDisplay {
  return deletedByOf(members)(row);
}

/** `deletedBy` over a member list looked up once, by id, for every cell of the grid. */
export function deletedByOf(members: readonly MemberSummary[]): (row: TrashRow) => ActorDisplay {
  const names = new Map(members.map((member) => [member.id, member.name]));
  return (row) => {
    const by = row.item.deletedBy;
    const name =
      by.type === 'system'
        ? strings.theSystem
        : by.type === 'api_key'
          ? strings.anApiKey
          : by.type === 'automation'
            ? strings.anAutomation
            : ((by.id === null ? undefined : names.get(by.id)) ?? strings.removedMember);
    return { type: by.type, id: by.id, name };
  };
}

/**
 * Whether Restore may run for the selected rows (AC-534): at least one of
 * their objects is one the person may change, or a row scrolled out of the
 * loaded ones (its object unknown here). The server refuses the rest, each
 * with its reason on its row.
 */
export function canRestore(
  rows: readonly (TrashRow | undefined)[],
  objects: ReadonlyMap<string, ObjectSummary>,
): boolean {
  return rows.some((row) => row === undefined || objects.get(row.item.objectId)?.access === 'write');
}

/** "1 record", "46 records". */
const records = (count: number) =>
  count === 1 ? strings.oneRecord : strings.records(new Intl.NumberFormat().format(count));

/**
 * The toast after a restore (AC-534): "Restored Ada Lovelace." or "Restored
 * 46 records.", and how many couldn't come back (each row says why).
 */
export function restoreToast(summary: RestoreSummary, onlyName: string | undefined): ToastContent | undefined {
  if (summary.kind === 'too-many') return { tone: 'danger', message: strings.tooMany };
  if (summary.kind === 'failed') return { tone: 'danger', message: summary.error.message || strings.somethingWrong };
  if (summary.restored === 0 && summary.refused === 0) return undefined;
  if (summary.restored === 0) return { tone: 'danger', message: strings.noneRestored(records(summary.refused)) };
  const restored =
    summary.restored === 1 && summary.refused === 0 && onlyName !== undefined
      ? strings.restoredOne(onlyName)
      : strings.restored(records(summary.restored));
  return summary.refused === 0
    ? { tone: 'success', message: restored }
    : { tone: 'danger', message: `${restored} ${strings.someRefused(summary.refused)}` };
}
