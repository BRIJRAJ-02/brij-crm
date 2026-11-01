// Likely duplicates (spec 0049, AC-4901 to AC-4909): the check while a member
// types, the paged pairs of the Duplicates page, and "Not a duplicate" with its
// Undo. Every answer names only records the reader may see (AC-4920).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { RecordRefDisplay } from './values/options.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The most matches one check answers (AC-4904). */
export const MAX_DUPLICATE_MATCHES = 3;
/** Pairs per page of the Duplicates page (AC-4907). */
export const DUPLICATE_PAGE_SIZE = 50;
/** The most draft values one check reads. */
export const MAX_CHECK_VALUES = 20;

/** Why two records look like one (AC-4901), in the order the rules are tried. */
export const DUPLICATE_REASONS = ['name_company', 'name', 'email', 'domain'] as const;
/** Why two records look like one. */
export const DuplicateReason = z.enum(DUPLICATE_REASONS);
/** Why two records look like one. */
export type DuplicateReason = z.infer<typeof DuplicateReason>;

/** Each reason as the hint, banner and page show it. */
export const DUPLICATE_REASON_WORDS: Readonly<Record<DuplicateReason, string>> = {
  name_company: 'Same name and company',
  name: 'Same name',
  email: 'Same email',
  domain: 'Same domain',
};

/** Draft values by attribute id, keyed as the caller spelled them (core canonicalises the keys). */
const DraftValues = z.record(z.uuid(), z.unknown());

/**
 * A check of draft values (AC-4904): the object, its draft values by attribute id (the create dialog's fields, or
 * the record page's, a person's Company included), and the record being edited, which never matches itself.
 */
export const CheckDuplicatesInput = WorkspaceScoped.extend({
  objectId: Uuid,
  values: DraftValues.refine((values) => Object.keys(values).length <= MAX_CHECK_VALUES, {
    error: 'Check at most 20 values.',
  }),
  excludeRecordId: Uuid.optional(),
});
/** A check of draft values. */
export type CheckDuplicatesInput = z.infer<typeof CheckDuplicatesInput>;

/** One live record the draft looks like, as a chip shows it, and why. */
export const DuplicateMatch = z.object({ record: RecordRefDisplay, reason: DuplicateReason });
/** One likely match. */
export type DuplicateMatch = z.infer<typeof DuplicateMatch>;

/** Up to 3 likely matches, the strongest rule first. */
export const DuplicateMatches = z.object({ matches: z.array(DuplicateMatch).max(MAX_DUPLICATE_MATCHES) });
/** Up to 3 likely matches. */
export type DuplicateMatches = z.infer<typeof DuplicateMatches>;

/** A page of an object's likely pairs (AC-4907), or only those of one record (the banner, AC-4906). */
export const ListDuplicatesInput = WorkspaceScoped.extend({
  objectId: Uuid,
  recordId: Uuid.optional(),
  /** The `cursor` a previous page answered. */
  cursor: z.string().max(200).optional(),
});
/** A page of likely pairs. */
export type ListDuplicatesInput = z.infer<typeof ListDuplicatesInput>;

/** One likely pair: the newer record first, the older second, and why. */
export const DuplicatePair = z.object({ a: RecordRefDisplay, b: RecordRefDisplay, reason: DuplicateReason });
/** One likely pair. */
export type DuplicatePair = z.infer<typeof DuplicatePair>;

/**
 * Up to 50 pairs, newest record first, and the cursor to go on with while the search has more to read. A page can
 * hold fewer than 50, or none, and still carry a cursor: each page reads a bounded number of records.
 */
export const DuplicatePairs = z.object({
  pairs: z.array(DuplicatePair).max(DUPLICATE_PAGE_SIZE),
  cursor: z.string().optional(),
});
/** A page of likely pairs. */
export type DuplicatePairs = z.infer<typeof DuplicatePairs>;

/** "Not a duplicate", or its Undo (AC-4908): the object and the pair's two records, in either order. */
export const DismissDuplicateInput = WorkspaceScoped.extend({
  objectId: Uuid,
  recordIds: z.tuple([Uuid, Uuid]),
  mutationId: Uuid,
});
/** A pair to dismiss or restore. */
export type DismissDuplicateInput = z.infer<typeof DismissDuplicateInput>;

/**
 * Likely duplicates (spec 0049). `check` needs read on the object and is limited to 60 calls a minute per member
 * (429 `RATE_LIMITED`); `list` needs read; `dismiss` and `restore` need write on the object and both records visible
 * (`FORBIDDEN`, `NOT_FOUND`).
 */
export const duplicatesContract = {
  check: oc.input(CheckDuplicatesInput).output(DuplicateMatches),
  list: oc.input(ListDuplicatesInput).output(DuplicatePairs),
  dismiss: oc.input(DismissDuplicateInput).output(z.object({ dismissed: z.literal(true) })),
  restore: oc.input(DismissDuplicateInput).output(z.object({ restored: z.literal(true) })),
};
