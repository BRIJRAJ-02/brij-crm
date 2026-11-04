// Whether changing a form's object asks first: it does when questions are saved onto the object now, naming them,
// since they stop saving there (the server remembers where, so switching back puts them back: forms fix a2). Pure,
// so the rule is tested apart from the editor.
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
  const filed = draft.questions.filter((question) => question.filedOn !== undefined);
  const filedCount = filed.length;
  if (filedCount === 0) return { kind: 'go' };
  const filedLabels = filed.map((question) => question.label.trim() || unnamed);
  const nameOf = (id: string | null) => objects.find((object) => object.id === id)?.pluralName ?? unnamed;
  return {
    kind: 'ask',
    ask: { objectId, filedCount, filedLabels, objectName: nameOf(current), nextName: nameOf(objectId) },
  };
}
