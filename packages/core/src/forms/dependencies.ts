// What a live form or booking page depends on, for the schema changes that
// would break it (27 October 2026). A form's document names an object and its
// attributes by id; archiving or changing one of those attributes doesn't
// touch the form, so the break only shows at the next submission, by which
// time a visitor has typed everything in. These reads let settings refuse the
// change instead, and name what it would break.
//
// Naming is the careful part. The change is refused whether or not the person
// making it may see the form: a break is a break. But a form they may not see
// is counted, never named (`canSeeForm`, spec 0009's hidden-means-absent),
// so the refusal degrades to "a live form" rather than leaking its name.
import { eq, sql } from 'drizzle-orm';
import { FormDocument } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { Access } from '../access/policy.ts';
import { canSeeForm, liveObjectOf } from './shared.ts';

const { bookingPages, formVersions, forms } = schema;

/** One live form, as a schema change needs to see it: the document visitors post to now, and whether to name it. */
export interface LiveForm {
  readonly id: string;
  readonly objectId: string;
  readonly document: FormDocument;
  /** Its name, only when the person making the change may see the form; absent when they may not. */
  readonly name?: string;
}

/**
 * The forms taking submissions onto `objectId` right now: status `live` with
 * a published version, read under row level security. A paused or draft form
 * is left out — nothing is posting to it, so a change can't fail a visitor —
 * and its own publish check runs again before it goes live.
 *
 * A form the reader may not see comes back without its `name`: the refusal
 * still counts it, so the guard never weakens, and never says which form.
 */
export async function liveFormsOn(tx: WorkspaceTx, access: Access, objectId: string): Promise<readonly LiveForm[]> {
  const rows = await tx
    .select({
      id: forms.id,
      name: forms.name,
      mainObjectId: forms.mainObjectId,
      liveVersionId: forms.liveVersionId,
      liveObjectId: liveObjectOf(),
      document: formVersions.document,
    })
    .from(forms)
    .innerJoin(formVersions, eq(formVersions.id, forms.liveVersionId))
    .where(
      sql`${forms.status} = 'live' and lower(${formVersions.document}->'targets'->'main'->>'objectId') = ${objectId}`,
    );
  return rows.flatMap((row) => {
    const parsed = FormDocument.safeParse(row.document);
    // A live document that no longer parses can't be reasoned about; it is left out rather than guessed at.
    if (!parsed.success) return [];
    const seen = canSeeForm(access, row);
    return [{ id: row.id, objectId, document: parsed.data, ...(seen ? { name: row.name } : {}) }];
  });
}

/** The attribute ids a form's questions file onto, whatever their answer type. */
export function filedBy(document: FormDocument): ReadonlySet<string> {
  return new Set(
    document.questions.flatMap((question) => (question.filedOn === undefined ? [] : [question.filedOn.attributeId])),
  );
}

/** One live booking page filing its answers onto an object, named only to someone who may see its object. */
export interface LivePage {
  readonly id: string;
  readonly title?: string;
}

/**
 * The booking pages filing their answers onto `objectId` right now, in one
 * statement: those naming it, and those naming nothing when it is the
 * workspace's People, which is what a null answers object means.
 */
export async function livePagesOn(tx: WorkspaceTx, objectId: string, isPeople: boolean): Promise<readonly LivePage[]> {
  const rows = await tx
    .select({ id: bookingPages.id, title: bookingPages.title })
    .from(bookingPages)
    .where(
      sql`${bookingPages.status} = 'live' and ${bookingPages.deletedAt} is null and (${bookingPages.answersObjectId} = ${objectId}::uuid${isPeople ? sql` or ${bookingPages.answersObjectId} is null` : sql``})`,
    );
  // A page's title is its host's, shown wherever its object is; whoever may change the object's schema may read it.
  return rows.map((row) => ({ id: row.id, title: row.title }));
}

/** Whether `objectId` is the workspace's live People, the object a page means by a null answers object. */
export async function isPeopleObject(tx: WorkspaceTx, objectId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.objects.id })
    .from(schema.objects)
    .where(sql`${schema.objects.standardKey} = 'people' and ${schema.objects.archivedAt} is null`);
  return row?.id === objectId;
}

/** A list of names in a sentence: "Apply", "Apply and Contact us", "Apply, Contact us and Careers". */
export function namesIn(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * How a set of things that would break reads in a refusal: at most three by
 * name, the rest counted, and the ones the reader may not see counted as
 * "N other" without a name. `one` and `many` are what a nameless thing is
 * called, as in "a live form" and "2 live forms".
 */
export function breakageNames(
  named: readonly string[],
  hidden: number,
  one: string,
  many: (count: number) => string,
): string {
  if (named.length === 0) return hidden === 1 ? one : many(hidden);
  const shown = named.slice(0, 3);
  const rest = named.length - shown.length + hidden;
  if (rest === 0) return namesIn(shown);
  return `${shown.join(', ')} and ${String(rest)} other${rest === 1 ? '' : 's'}`;
}
