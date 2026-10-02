// The refusals the data engine (spec 0004) answers with: a stable code and a
// plain sentence. Services, endpoints and screens all branch on the code.
import { ATTRIBUTE_VALUE_INVALID } from './attribute-values.ts';

/** Every code a data engine refusal can carry. */
export const ENGINE_REFUSAL_CODES = [
  ATTRIBUTE_VALUE_INVALID,
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
  'CONFIG_INVALID',
  'NOT_FOUND',
  'ID_TAKEN',
  'FILTER_INVALID',
  'QUERY_CANCELLED',
] as const;

/** One of the engine's refusal codes. */
export type EngineRefusalCode = (typeof ENGINE_REFUSAL_CODES)[number];

/** Why a write or a query was refused: the code, how to fix it, and the attribute it's about, when there is one. */
export interface EngineRefusal {
  readonly code: EngineRefusalCode;
  readonly message: string;
  readonly attributeId?: string;
}
