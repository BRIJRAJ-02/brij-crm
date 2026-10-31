// The refusals the data engine (spec 0004) answers with: a stable code and a
// plain sentence. Services, endpoints and screens all branch on the code.
// No imports, so the browser can read the codes without Zod (`../codes.ts`).

/** Every code a data engine refusal can carry. `ATTRIBUTE_VALUE_INVALID` equals the constant in `attribute-values.ts` (a test checks). */
export const ENGINE_REFUSAL_CODES = [
  'ATTRIBUTE_VALUE_INVALID',
  'VALUE_REQUIRED',
  'UNIQUE_CONFLICT',
  'UNIQUE_HAS_DUPLICATES',
  'OPTION_ARCHIVED',
  'RECORD_DELETED',
  // A write landed but left the record where its writer can no longer see it (spec 0032, AC-848): their record rule.
  'RECORD_OUT_OF_SCOPE',
  'RELATIONSHIP_TAKEN',
  'ENTRY_EXISTS',
  'ATTRIBUTE_READ_ONLY',
  'LIMIT_REACHED',
  'SLUG_TAKEN',
  // An object name another object of the workspace holds, ignoring case, archived ones included (spec 0012).
  'NAME_TAKEN',
  'CONFIG_INVALID',
  'NOT_FOUND',
  'ID_TAKEN',
  'FILTER_INVALID',
  'QUERY_CANCELLED',
  'FORBIDDEN',
  'LAST_OWNER',
  'VERSION_CHANGED',
  // Background jobs (spec 0008).
  'JOB_FINISHED',
  'JOB_NOT_CANCELLABLE',
  'JOB_NOT_READY',
  'JOB_EXPIRED',
  'JOB_TOO_LARGE',
  // A write that breaks an attribute's rules (spec 0013, AC-254): one refusal per failing rule, each with its ruleId.
  'VALIDATION_FAILED',
  // Changing an attribute's type in place (the field types pass): a value that doesn't convert, or something that
  // depends on the attribute and can't follow (a board's grouping, a view's filter, a live form).
  'TYPE_CHANGE_REFUSED',
  // Saved views (spec 0020): the filter or sorts were saved by someone else since the draft began; the default
  // view can't be deleted or made private.
  'VIEW_CHANGED',
  'VIEW_IS_DEFAULT',
  // Forms (spec 0023): the draft was saved by someone else since the editor began; a status change or a
  // submission action that doesn't fit where it is; a form that isn't taking responses.
  'FORM_CHANGED',
  'FORM_STATE',
  'FORM_CLOSED',
  // Booking pages (spec 0025): the slot went to someone else between the offer and the booking; the page is paused
  // or deleted, or the host can't be booked.
  'SLOT_TAKEN',
  'BOOKING_CLOSED',
  // Calendar sync (spec 0024, AC-618): the member has no connected calendar to write an event to.
  'CALENDAR_NOT_CONNECTED',
  // Invitations (spec 0031): an expired, revoked, used or unknown invitation (all one answer); an invitation for
  // another address; too many open invitations; no free seat on the plan.
  'INVITE_INVALID',
  'INVITE_EMAIL_MISMATCH',
  'INVITES_LIMIT',
  'SEAT_LIMIT',
  // Availability schedules (spec 0035): a member's 20 are used; the schedule was saved by someone else since the
  // editor began; the default can't be deleted; a page may only book by a schedule of its owner.
  'SCHEDULE_LIMIT',
  'STALE',
  'DEFAULT_SCHEDULE',
  'SCHEDULE_NOT_ALLOWED',
  // Round robin (spec 0029, AC-758): a rotation a page or form still books from can't be deleted.
  'IN_USE',
  // A round robin page's hosts don't fit (spec 0037): 1 to 3 rotations and at most 8 hosts in all.
  'HOSTS_INVALID',
  // Scheduling access (spec 0037, AC-1255, AC-1256): a delegate who can't hold one (removed, the target themself, a
  // team before teams exist); a delegate holding 50 or a member with 20 delegates.
  'DELEGATE_INVALID',
  'DELEGATION_LIMIT',
  // Time off (spec 0037, AC-1288): a member with 50 upcoming time off entries.
  'TIME_OFF_LIMIT',
  // The sidebar (spec 0034, AC-934): 50 favourites, or 400 stored items.
  'NAV_LIMIT',
  // Domain join (spec 0031, AC-819): a domain the admin's own verified email isn't at, or a public mail domain.
  'DOMAIN_NOT_YOURS',
  'DOMAIN_PUBLIC',
  // Deleting a workspace (spec 0031, AC-823): the typed name isn't the workspace's.
  'CONFIRM_MISMATCH',
  // Milestone 5 (AC-996, AC-1004): a destination the member can only read, or whose account stopped.
  'CALENDAR_NOT_WRITABLE',
  // Account security (spec 0033, AC-896): a sensitive account change on a session not verified in the last 10 minutes.
  'STEP_UP_REQUIRED',
  'SECOND_FACTOR_REQUIRED',
  'CODE_INVALID',
  'SIGN_IN_EXPIRED',
  // Import and export (spec 0040): rows sent after the import started, an undo while it runs or past its window,
  // and a view with more rows than one export writes.
  'IMPORT_STARTED',
  'IMPORT_RUNNING',
  'IMPORT_UNDO_CLOSED',
  'EXPORT_TOO_LARGE',
  // A workspace's sign in rules (spec 0033, milestone 4): it requires two factor and this person has none (AC-894);
  // this session signed in longer ago than the workspace allows, or before everyone was signed out of it; an owner
  // without two factor can't require it (AC-893); a second factor can't be turned off while a workspace requires it
  // (AC-885, AC-887).
  'TWO_FACTOR_REQUIRED',
  'SIGN_IN_AGAIN',
  'OWNER_NEEDS_TWO_FACTOR',
  'WORKSPACE_REQUIRES_TWO_FACTOR',
  // Record merge (spec 0049, AC-4917): a record changed while the dialog was open; two records that can't be merged
  // (the same one, or of different objects); more attached than one merge moves.
  'CONFLICT',
  'INVALID',
  'MERGE_TOO_LARGE',
] as const;

/** One of the engine's refusal codes. */
export type EngineRefusalCode = (typeof ENGINE_REFUSAL_CODES)[number];

/**
 * Why a write or a query was refused: the code, how to fix it, and the
 * attribute it's about, or the field of the caller's input it's about (a
 * definition write's `pluralName` or `apiSlug`), when there is one.
 */
export interface EngineRefusal {
  readonly code: EngineRefusalCode;
  readonly message: string;
  readonly attributeId?: string;
  readonly field?: string;
  /** The rule a `VALIDATION_FAILED` refusal is about (spec 0013). */
  readonly ruleId?: string;
  /**
   * The record holding a `UNIQUE_CONFLICT` value, only when the writer may see it (spec 0049, AC-4905), with its
   * name as they may read it (empty when its name is hidden from them).
   */
  readonly holder?: { readonly recordId: string; readonly objectId: string; readonly name: string };
}
