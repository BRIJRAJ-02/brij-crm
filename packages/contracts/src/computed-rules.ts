// `@crm/contracts/computed`: the rules of computed attributes (spec 0015) that
// the attribute dialog and the engine share, plain TypeScript with no Zod:
// which attributes a lookup or a rollup may read, what result type each
// gives, the limits, and the read only reasons a cell shows.

/** The kinds of computed attribute. */
export const COMPUTED_KINDS = ['lookup', 'rollup', 'formula'] as const;
/** A kind of computed attribute. */
export type ComputedKind = (typeof COMPUTED_KINDS)[number];

/** A rollup's calculations, in the order the dialog offers them (AC-315). */
export const ROLLUP_CALCS = ['count', 'count_where', 'sum', 'average', 'min', 'max', 'earliest', 'latest'] as const;
/** A rollup's calculation. */
export type RollupCalc = (typeof ROLLUP_CALCS)[number];

/** The most distinct values a lookup through a side that holds many shows (AC-313). */
export const LOOKUP_ITEMS = 100;
/** How deep computed attributes may build on each other (AC-326). */
export const MAX_COMPUTED_DEPTH = 3;
/** The most computed attributes one object holds (AC-331). */
export const COMPUTED_PER_OBJECT = 50;

/** The types a lookup through a side that holds many may show: the ones that hold several values (AC-313). */
export const MANY_LOOKUP_TYPES: readonly string[] = [
  'select',
  'status',
  'email',
  'phone',
  'url',
  'domain',
  'actor_reference',
];

/** The number types Sum, Average, Min and Max add up (AC-315). */
export const ROLLUP_NUMBER_TYPES: readonly string[] = ['number', 'currency', 'rating'];

/** An attribute as these rules read it: on the far object for a lookup or a rollup. */
export interface ComputedSource {
  readonly type: string;
  readonly isMulti: boolean;
  readonly isSystem: boolean;
  readonly apiSlug: string;
  readonly isArchived: boolean;
}

/** A computed attribute's result type: what it is stored as. */
export interface ComputedResultType {
  readonly type: string;
  readonly isMulti: boolean;
}

const isCreatedAt = (source: ComputedSource) => source.isSystem && source.apiSlug === 'created_at';
const isCreatedBy = (source: ComputedSource) => source.isSystem && source.apiSlug === 'created_by';

/**
 * Why a lookup can't show `target` (AC-313), or undefined when it can: any live attribute of the related object
 * except relationships, files and its id (Created at and Created by are offered, the other system ones aren't);
 * through a side that holds many, only types that can hold several values.
 */
export function lookupTargetProblem(target: ComputedSource, throughMany: boolean): string | undefined {
  if (target.isArchived) return 'It is archived.';
  if (target.isSystem && !isCreatedAt(target) && !isCreatedBy(target)) return "It can't be looked up.";
  if (target.type === 'record_reference' || target.type === 'file') return "It can't be looked up.";
  if (throughMany && !isCreatedBy(target) && !MANY_LOOKUP_TYPES.includes(target.type)) {
    return 'Only fields that hold several values can be looked up through many records.';
  }
  return undefined;
}

/** A lookup's result type (AC-313): the target's; through many it holds several, and a Status becomes a Multi select. */
export function lookupResult(target: ComputedSource, throughMany: boolean): ComputedResultType {
  if (!throughMany) return { type: target.type, isMulti: target.isMulti };
  return { type: target.type === 'status' ? 'select' : target.type, isMulti: true };
}

/** Whether a calculation reads an attribute of the related records (every one but the counts). */
export function rollupTakesTarget(calc: RollupCalc): boolean {
  return calc !== 'count' && calc !== 'count_where';
}

/**
 * Why a rollup's calculation can't read `target` (AC-315), or undefined: Number, Currency or Rating for Sum,
 * Average, Min and Max; Date or Created at for Earliest and Latest. Updated at is never offered (owner decision).
 */
export function rollupTargetProblem(calc: RollupCalc, target: ComputedSource): string | undefined {
  if (!rollupTakesTarget(calc)) return undefined;
  if (target.isArchived) return 'It is archived.';
  if (calc === 'earliest' || calc === 'latest') {
    return target.type === 'date' || isCreatedAt(target) ? undefined : 'Pick a date.';
  }
  if (target.isSystem || target.isMulti || !ROLLUP_NUMBER_TYPES.includes(target.type)) return 'Pick a number.';
  return undefined;
}

/** A rollup's result type (AC-316): counts and number sums give Number, Currency gives Currency, dates Date. */
export function rollupResult(calc: RollupCalc, target: ComputedSource | undefined): ComputedResultType {
  if (calc === 'count' || calc === 'count_where' || target === undefined) return { type: 'number', isMulti: false };
  if (calc === 'earliest' || calc === 'latest') {
    return { type: isCreatedAt(target) ? 'timestamp' : 'date', isMulti: false };
  }
  return { type: target.type === 'currency' ? 'currency' : 'number', isMulti: false };
}

/** The word each kind is called by: the type picker's entry and the Attributes tab's badge. */
export const COMPUTED_KIND_LABELS: Readonly<Record<ComputedKind, string>> = {
  lookup: 'Lookup',
  rollup: 'Rollup',
  formula: 'Formula',
};

/**
 * Why a computed attribute's cells can't be edited (AC-323, AC-327): "Worked out by a lookup", or, while it has
 * stopped updating, "Not updating: <reason>".
 */
export function computedReadOnlyReason(kind: ComputedKind, error?: string): string {
  if (error !== undefined) return `Not updating: ${error}`;
  return `Worked out by a ${kind}`;
}
