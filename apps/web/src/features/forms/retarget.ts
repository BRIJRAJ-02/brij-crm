// Whether changing a form's object asks first (the owner's rule, 21 October 2026: anything that ends something asks
// first): it does when questions are saved onto the object now, since the change clears where each is saved and
// nothing takes it back. Pure, so the rule is tested apart from the editor.
import type { FormDocument, ObjectSummary } from '@crm/data';
import type { RetargetAsk } from './FormConfirms.tsx';

/** What a press on the CRM card's Switch or Select does: nothing, the change at once, or a confirm first. */
export type RetargetStep =
  { readonly kind: 'nothing' } | { readonly kind: 'go' } | { readonly kind: 'ask'; readonly ask: RetargetAsk };

/**
 * The step for moving `draft` to `objectId` (null: saving to the CRM off).
 * The object it already files to does nothing; with no question saved
 * anywhere the change goes at once; otherwise it asks, naming how many
 * questions are saved, the object now and the one asked for.
 */
export function retargetStep(
  draft: Pick<FormDocument, 'questions' | 'targets'>,
  objects: readonly Pick<ObjectSummary, 'id' | 'pluralName'>[],
  objectId: string | null,
  unnamed: string,
): RetargetStep {
  const current = draft.targets.main?.objectId ?? null;
  if (current === objectId) return { kind: 'nothing' };
  const filedCount = draft.questions.filter((question) => question.filedOn !== undefined).length;
  if (filedCount === 0) return { kind: 'go' };
  const nameOf = (id: string | null) => objects.find((object) => object.id === id)?.pluralName ?? unnamed;
  return { kind: 'ask', ask: { objectId, filedCount, objectName: nameOf(current), nextName: nameOf(objectId) } };
}
