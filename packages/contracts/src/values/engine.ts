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
}
