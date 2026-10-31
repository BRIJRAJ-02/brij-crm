// The Trash screen's pure parts (spec 0022, AC-533, AC-534): its synthetic
// columns, what each cell shows, whether Restore may run, and the restore
// toast. Kept apart from the screen, so the node tests cover them.
import type {
  ActorDisplay,
  FieldAttributeShape,
  MemberSummary,
  ObjectSummary,
  PurgeSummary,
  RestoreSummary,
  TrashRow,
} from '@crm/data';
import type { ToastContent } from '@crm/ui';
import { isPassing } from '../workspace/bulk.ts';
import { strings } from './strings.ts';
import { sharedStrings } from '@crm/ui';

/** The trash's columns, by id: Name (the row header), Object, Deleted by, Deleted, Deleted forever on. */
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
      return item.deletedBy ?? null;
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
export function deletedBy(row: TrashRow, members: readonly MemberSummary[]): ActorDisplay | undefined {
  return deletedByOf(members)(row);
}

/** `deletedBy` over a member list looked up once, by id, for every cell of the grid. */
export function deletedByOf(members: readonly MemberSummary[]): (row: TrashRow) => ActorDisplay | undefined {
  const names = new Map(members.map((member) => [member.id, member.name]));
  return (row) => {
    const by = row.item.deletedBy;
    // Hidden by a field rule (spec 0017): the cell is empty.
    if (by === undefined) return undefined;
    const name =
      by.type === 'system'
        ? strings.theSystem
        : by.type === 'api_key'
          ? strings.anApiKey
          : by.type === 'automation'
            ? strings.anAutomation
            : by.type === 'form'
              ? strings.aForm
              : by.type === 'booking'
                ? strings.aBookingPage
                : ((by.id === null ? undefined : names.get(by.id)) ?? strings.removedMember);
    return { type: by.type, id: by.id, name };
  };
}

/**
 * Whether Restore may run for the selected rows (AC-534): at least one of
 * their objects is one the person may change, or a row scrolled out of the
 * loaded ones (its object unknown here). The server refuses the rest, each
 * with its reason on its row. It stops at the first such row, so a large
 * selection costs little.
 */
export function canRestore(
  ids: Iterable<string>,
  rowOf: (recordId: string) => TrashRow | undefined,
  objects: ReadonlyMap<string, ObjectSummary>,
): boolean {
  for (const id of ids) {
    const row = rowOf(id);
    if (row === undefined || objects.get(row.item.objectId)?.access === 'write') return true;
  }
  return false;
}

/** "1 record", "46 records". */
const records = (count: number) =>
  count === 1 ? strings.oneRecord : strings.records(new Intl.NumberFormat().format(count));

/**
 * The toast after a restore (AC-534): "Restored Ada Lovelace." or "Restored
 * 46 records.", and how many couldn't come back (each row says why).
 */
export function restoreToast(
  summary: RestoreSummary,
  onlyName: string | undefined,
  onRetry?: () => void,
): ToastContent | undefined {
  if (summary.kind === 'too-many') return { tone: 'danger', message: strings.tooMany };
  if (summary.kind === 'failed') {
    const message = summary.error.message || sharedStrings.couldntDoThat;
    return onRetry !== undefined && isPassing(summary.error.code)
      ? { tone: 'danger', message, action: { label: strings.retry, onAction: onRetry } }
      : { tone: 'danger', message };
  }
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

/**
 * Whether Restore may run for all matching (AC-534): at least one object in
 * the list's scope (the object filter, or every object listed) is one the
 * person may change.
 */
export function canRestoreAll(objectId: string | undefined, objects: readonly ObjectSummary[]): boolean {
  return objects.some((object) => (objectId === undefined || object.id === objectId) && object.access === 'write');
}

/**
 * The toast after Delete forever (AC-535): "Deleted 48 records forever.", how
 * many were no longer there, and how many were refused (an object the person
 * may only read, AC-538 as amended), in restore's words: each row says why.
 */
export function purgeToast(summary: PurgeSummary, onRetry?: () => void): ToastContent | undefined {
  if (summary.kind === 'too-many') return { tone: 'danger', message: strings.tooManyDelete };
  if (summary.kind === 'failed') {
    const message = summary.error.message || sharedStrings.couldntDoThat;
    return onRetry !== undefined && isPassing(summary.error.code)
      ? { tone: 'danger', message, action: { label: strings.retry, onAction: onRetry } }
      : { tone: 'danger', message };
  }
  if (summary.purged === 0 && summary.skipped === 0 && summary.refused === 0) return undefined;
  if (summary.purged === 0 && summary.refused > 0) {
    return { tone: 'danger', message: strings.noneDeleted(records(summary.refused)) };
  }
  const purged = summary.purged === 1 ? strings.purgedOne : strings.purged(records(summary.purged));
  const message = [
    purged,
    summary.skipped === 0 ? '' : strings.purgedSkipped(summary.skipped),
    summary.refused === 0 ? '' : strings.someNotDeleted(summary.refused),
  ]
    .filter((sentence) => sentence !== '')
    .join(' ');
  // Rows left behind need the person's eye, as a restore that left some does.
  return { tone: summary.refused === 0 ? 'success' : 'danger', message };
}
