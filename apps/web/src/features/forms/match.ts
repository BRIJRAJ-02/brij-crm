// The email a form matches its submissions on (the owner, 27 October 2026). A form filing onto an object needs one
// unique email attribute there, with the email question filed on it, so a submission updates the record it belongs to
// instead of adding another. An object made by hand often has an email attribute that isn't unique, and the form
// then refused to publish while showing its email question filed exactly where it should be, with no way past.
// Publish now makes that attribute the match: unique, and the object asked for again so the match is worked out.
import { isDataError, type DataLayer, type FormDocument, type FormTargetChoices, type FormView } from '@crm/data';
import { strings } from './strings.ts';

/**
 * The email attribute to make unique, or undefined: the form files onto an object with no unique email of its own,
 * and its email question is filed on an email attribute that isn't one. Never a second unique email beside one the
 * object already has: that one is the match, and the email question belongs on it.
 */
export function emailToMakeUnique(draft: FormDocument, target: FormTargetChoices): string | undefined {
  if (draft.targets.main === undefined) return undefined;
  if (target.items.some((attribute) => attribute.isUnique && attribute.type === 'email')) return undefined;
  const filed = draft.questions.find((question) => question.answerType === 'email' && question.filedOn !== undefined)
    ?.filedOn?.attributeId;
  const attribute = target.items.find((each) => each.attributeId === filed);
  return attribute !== undefined && attribute.type === 'email' && attribute.canWrite
    ? attribute.attributeId
    : undefined;
}

/** Whether the draft already matches on the attribute its email question is filed on. */
function isMatched(draft: FormDocument): boolean {
  const match = draft.targets.main?.matchAttributeId;
  return (
    match !== undefined &&
    draft.questions.some((question) => question.answerType === 'email' && question.filedOn?.attributeId === match)
  );
}

/**
 * What Publish checks after the match is ready, and the form's view when it changed; or the sentence that says why
 * the email couldn't become the match, which the caller shows as it shows any other reason Publish stops.
 */
export type ReadyMatch =
  | {
      readonly document: FormDocument;
      readonly choices: FormTargetChoices;
      readonly view?: FormView;
    }
  | { readonly refused: string };

/**
 * Gets the form's match ready before Publish checks it: the email question's attribute made unique where the object
 * has no unique email (only for a member who may change attributes), then the same object asked for again, which
 * works out the match over the attributes as they are now. Nothing is asked when the draft already matches. A
 * refusal to make it unique because two records already share an email answers a sentence saying so; anything else
 * unexpected throws.
 */
export async function readyMatch(
  deps: {
    readonly data: DataLayer;
    readonly slug: string;
    readonly formId: string;
    readonly canChangeAttributes: boolean;
    readonly flush: () => Promise<number>;
  },
  draft: FormDocument,
  target: FormTargetChoices,
): Promise<ReadyMatch> {
  const objectId = draft.targets.main?.objectId;
  if (objectId === undefined || isMatched(draft)) return { document: draft, choices: target };
  const unique = deps.canChangeAttributes ? emailToMakeUnique(draft, target) : undefined;
  if (unique !== undefined) {
    try {
      await deps.data.attributes.update(deps.slug, unique, { isUnique: true });
    } catch (failure) {
      if (isDataError(failure) && failure.code === 'UNIQUE_HAS_DUPLICATES') {
        return { refused: strings.matchHasDuplicates(target.objectName ?? '') };
      }
      throw failure;
    }
  }
  const revision = await deps.flush();
  const view = await deps.data.forms.setTarget(deps.slug, deps.formId, objectId, revision);
  const choices = await deps.data.forms.attributes(deps.slug, deps.formId);
  return { document: view.draft, choices, view };
}
