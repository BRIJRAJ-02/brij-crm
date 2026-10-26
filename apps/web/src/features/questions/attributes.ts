// The attributes a builder creates for questions with nothing to file onto (spec 0023's publish, spec 0057's save):
// one per plan, with no prompt, through the data layer, so a form and a booking page create them the same way.
import { isDataError, type DataLayer } from '@crm/data';
import type { PlannedAttribute } from './questions.ts';

/** A question filed onto the attribute just made for it. */
export interface MadeAttribute {
  readonly questionId: string;
  readonly attributeId: string;
}

/**
 * Creates each planned attribute on `objectId`, in order, and answers the ones made. A hidden attribute may hold a
 * title already: the server says `SLUG_TAKEN`, and a numbered title goes next (up to five). Any other refusal leaves
 * that question unfiled, and the rest go on.
 */
export async function createPlannedAttributes(
  data: Pick<DataLayer, 'attributes'>,
  slug: string,
  objectId: string,
  plans: readonly PlannedAttribute[],
): Promise<readonly MadeAttribute[]> {
  const made: MadeAttribute[] = [];
  for (const plan of plans) {
    for (let n = 1; n <= 5; n += 1) {
      const title = n === 1 ? plan.title : `${plan.title} ${String(n)}`;
      try {
        const attribute = await data.attributes.create(slug, {
          id: data.attributes.newId(),
          objectId,
          title,
          type: plan.type,
          ...(plan.isUnique === true ? { isUnique: true } : {}),
          ...(plan.type === 'select'
            ? {
                options: plan.choices.map((label) => ({
                  id: data.attributes.newId(),
                  label,
                  hue: 'gray' as const,
                })),
              }
            : {}),
        });
        made.push({ questionId: plan.questionId, attributeId: attribute.id });
        break;
      } catch (error: unknown) {
        if (!(isDataError(error) && error.code === 'SLUG_TAKEN')) break;
      }
    }
  }
  return made;
}

/** Undo for attributes just made: archives each (their questions are unfiled by the caller). */
export function archiveMadeAttributes(
  data: Pick<DataLayer, 'attributes'>,
  slug: string,
  made: readonly MadeAttribute[],
): Promise<unknown> {
  return Promise.all(made.map((each) => data.attributes.archive(slug, each.attributeId)));
}
