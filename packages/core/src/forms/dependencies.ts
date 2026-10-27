// What a live form depends on, for the schema changes that would break it
// (27 October 2026). A form's document names an object and its attributes by
// id; archiving or changing one of those attributes doesn't touch the form,
// so the break only shows at the next submission, by which time a visitor has
// typed everything in. These reads let settings refuse the change instead,
// and name the forms it would break.
//
// Imports nothing from `../engine/`, so `engine/definitions.ts` may read it
// without a cycle.
import { eq, sql } from 'drizzle-orm';
import { FormDocument } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';

const { bookingPages, formVersions, forms } = schema;

/** One live form, as a schema change needs to see it: its name, and the document visitors are posting to now. */
export interface LiveForm {
  readonly id: string;
  readonly name: string;
  readonly objectId: string;
  readonly document: FormDocument;
}

/**
 * The forms taking submissions onto `objectId` right now: status `live` with
 * a published version, read under row level security. A paused or draft form
 * is left out — nothing is posting to it, so a change can't fail a visitor —
 * and its own publish check runs again before it goes live.
 */
export async function liveFormsOn(tx: WorkspaceTx, objectId: string): Promise<readonly LiveForm[]> {
  const rows = await tx
    .select({ id: forms.id, name: forms.name, document: formVersions.document })
    .from(forms)
    .innerJoin(formVersions, eq(formVersions.id, forms.liveVersionId))
    .where(
      sql`${forms.status} = 'live' and lower(${formVersions.document}->'targets'->'main'->>'objectId') = ${objectId}`,
    );
  return rows.flatMap((row) => {
    const parsed = FormDocument.safeParse(row.document);
    // A document that no longer parses is a broken invariant elsewhere; it can't be reasoned about here.
    return parsed.success ? [{ id: row.id, name: row.name, objectId, document: parsed.data }] : [];
  });
}

/** The attribute ids a form's questions file onto, whatever their answer type. */
export function filedBy(document: FormDocument): ReadonlySet<string> {
  return new Set(
    document.questions.flatMap((question) => (question.filedOn === undefined ? [] : [question.filedOn.attributeId])),
  );
}

/** The live booking pages filing their answers onto `objectId`; `people` is the object a page means by null. */
export async function livePagesOn(
  tx: WorkspaceTx,
  objectId: string,
  people: string | undefined,
): Promise<readonly { readonly id: string; readonly title: string }[]> {
  const rows = await tx
    .select({ id: bookingPages.id, title: bookingPages.title, answersObjectId: bookingPages.answersObjectId })
    .from(bookingPages)
    .where(sql`${bookingPages.status} = 'live' and ${bookingPages.deletedAt} is null`);
  return rows.flatMap((row) =>
    (row.answersObjectId ?? people) === objectId ? [{ id: row.id, title: row.title }] : [],
  );
}

/** A list of names in a sentence: "Apply", "Apply and Contact us", "Apply, Contact us and Careers". */
export function namesIn(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** What at most three names read as, the rest counted: a workspace may have many forms on one object. */
export function someNames(names: readonly string[]): string {
  if (names.length <= 3) return namesIn(names);
  const rest = names.length - 3;
  return `${names.slice(0, 3).join(', ')} and ${String(rest)} other${rest === 1 ? '' : 's'}`;
}

/** The workspace's live People object, which a booking page means by a null answers object. */
export async function peopleId(tx: WorkspaceTx): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: schema.objects.id })
    .from(schema.objects)
    .where(sql`${schema.objects.standardKey} = 'people' and ${schema.objects.archivedAt} is null`);
  return row?.id;
}
