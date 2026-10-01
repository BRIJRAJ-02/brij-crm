// The shapes that travel with values: an attribute's options, a value's
// history, and the display shapes the data layer (#6) builds so fields never
// resolve ids themselves.
import * as z from 'zod';
import { ActorReferenceValue, EmailValue, FileValue, Timestamp, type AttributeType } from './attribute-values.ts';
import { Hue } from './hues.ts';

const option = z.object({
  id: z.string().trim().min(1),
  label: z
    .string()
    .trim()
    .min(1, { error: 'Give the option a name.' })
    .max(100, { error: 'Keep an option name to 100 characters.' }),
  hue: Hue,
  archived: z.boolean(),
});

/** One option of a select attribute. Order is the order on the attribute; an archived option shows muted and can't be chosen. */
export const SelectOption = option;
export type SelectOption = z.infer<typeof SelectOption>;

/** One status of a status attribute, shown as a dot in its hue. */
export const StatusOption = option;
export type StatusOption = z.infer<typeof StatusOption>;

/**
 * One version of one attribute's whole value on one record. The current
 * version has `activeUntil: null`; the history is the versions in `activeFrom`
 * order. `value` parses with the attribute's own schema (`attributeValueSchema`).
 */
export const ValueVersion = z.object({
  value: z.unknown(),
  activeFrom: Timestamp,
  activeUntil: Timestamp.nullable(),
  setBy: ActorReferenceValue,
});
export type ValueVersion = z.infer<typeof ValueVersion>;

/** How a linked record shows: its name, kind (person circle, company square), and picture or hue. */
export const RecordRefDisplay = z.object({
  objectId: z.string().min(1),
  recordId: z.string().min(1),
  name: z.string(),
  kind: z.enum(['person', 'company', 'other']),
  imageSrc: z.string().optional(),
  hue: Hue.optional(),
});
export type RecordRefDisplay = z.infer<typeof RecordRefDisplay>;

/** How an actor shows. The system shows as "System"; an automation or key under its own name. */
export const ActorDisplay = z.object({
  type: z.enum(['member', 'api_key', 'automation', 'system']),
  id: z.string().min(1).nullable(),
  name: z.string(),
  /** Members only: shown in the member picker, and matched first when a member is pasted. */
  email: EmailValue.optional(),
  imageSrc: z.string().optional(),
  hue: Hue.optional(),
});
export type ActorDisplay = z.infer<typeof ActorDisplay>;

/** How a file shows: the file, plus its thumbnail and download link from #32. */
export const FileDisplay = FileValue.extend({
  thumbnailSrc: z.string().optional(),
  href: z.string().optional(),
});
export type FileDisplay = z.infer<typeof FileDisplay>;

/** The display shape each type needs, if any. A list value gets a list of displays in the same order. */
export interface DisplayMap {
  readonly record_reference: RecordRefDisplay;
  readonly actor_reference: ActorDisplay;
  readonly interaction: ActorDisplay;
  readonly file: FileDisplay;
}

/** The display shape for an attribute type, or `undefined` for types that show their value as it is. */
export type DisplayFor<T extends AttributeType> = T extends keyof DisplayMap ? DisplayMap[T] : undefined;
