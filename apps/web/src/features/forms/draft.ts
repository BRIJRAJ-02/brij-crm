// The builder's changes to a draft (spec 0023, 0023-experience.md, Questions):
// plain functions over the document, each answering a new one, so the screen
// keeps one draft in state and the tests check every rule here. The question
// list's own rules live in the shared editor (`features/questions/questions.ts`,
// spec 0057, which a booking page uses too); these wrap them over a form.
import type { FormAttributeChoice, FormDocument, FormQuestion, FormTargetChoices, FormView } from '@crm/data';
import { FORM_SLUG, type PublishAttribute, type QuestionPreset, slugFromName } from '@crm/data/forms';
import * as list from '../questions/questions.ts';
import type { PlannedAttribute, QuestionChange } from '../questions/questions.ts';
import { strings } from './strings.ts';

/** A new question at the end: Short text, no label yet ("Untitled question"), not filed, optional. */
export function addQuestion(document: FormDocument, id: string): FormDocument {
  return { ...document, questions: list.addQuestion(document.questions, id) };
}

/** A preset's question at the end, not filed, its key made free. */
export function addPreset(document: FormDocument, preset: QuestionPreset, id: string): FormDocument {
  return { ...document, questions: list.addPreset(document.questions, preset, id) };
}

/** A copy right below `id`, its key suffixed (`company_2`) and not filed, so two questions never share an attribute. */
export function duplicateQuestion(document: FormDocument, id: string, copyId: string): FormDocument {
  return { ...document, questions: list.duplicateQuestion(document.questions, id, copyId) };
}

/** The draft without `id`, and what Undo needs to put it back where it was. */
export function removeQuestion(
  document: FormDocument,
  id: string,
): { readonly document: FormDocument; readonly removed?: { readonly question: FormQuestion; readonly index: number } } {
  const { questions, removed } = list.removeQuestion(document.questions, id);
  return removed === undefined ? { document } : { document: { ...document, questions }, removed };
}

/** A removed question back at its place (Undo), its key made free and its filing dropped if taken meanwhile. */
export function restoreQuestion(document: FormDocument, question: FormQuestion, index: number): FormDocument {
  return { ...document, questions: list.restoreQuestion(document.questions, question, index) };
}

/** The draft with `id` moved to `index`. */
export function moveQuestion(document: FormDocument, id: string, index: number): FormDocument {
  return { ...document, questions: list.moveQuestion(document.questions, id, index) };
}

/**
 * The draft with one question changed (`changeQuestion` in the shared editor): a key that changes with its label is
 * followed by Show when and by the form's routing rules (spec 0043).
 */
export function changeQuestion(
  document: FormDocument,
  id: string,
  change: QuestionChange,
  liveIds: ReadonlySet<string> = new Set(),
): FormDocument {
  return withQuestions(document, list.changeQuestion(document.questions, id, change, liveIds));
}

/**
 * The draft with a new list of questions: each key a question changed is followed by the routing rules too, so a
 * rule never reads a key that is gone. The shared editor changes the list; this keeps the rest of the form in step.
 */
export function withQuestions(document: FormDocument, questions: readonly FormQuestion[]): FormDocument {
  const renames = list.renamedKeys(document.questions, questions);
  const next: FormDocument = { ...document, questions: [...questions] };
  return renames.reduce((each, [from, to]) => renameRouting(each, from, to), next);
}

/** The document with every condition reading `from` reading `to` instead: Show when and routing rules alike. */
export function renameKey(document: FormDocument, from: string, to: string): FormDocument {
  return renameRouting({ ...document, questions: list.renameShowWhen(document.questions, from, to) }, from, to);
}

/** The document with every routing rule's condition reading `from` reading `to` instead. */
function renameRouting(document: FormDocument, from: string, to: string): FormDocument {
  return {
    ...document,
    routing: {
      rules: document.routing.rules.map((rule) => ({
        ...rule,
        when: {
          ...rule.when,
          rules: rule.when.rules.map((condition) => (condition.key === from ? { ...condition, key: to } : condition)),
        },
      })),
    },
  };
}

/** Whether `question` is the email question the form matches people by: it can't be deleted. */
export function isMatchQuestion(document: FormDocument, question: FormQuestion): boolean {
  const match = document.targets.main?.matchAttributeId;
  return match !== undefined && question.answerType === 'email' && question.filedOn?.attributeId === match;
}

/**
 * Files each unfiled question whose label or key names a free attribute that
 * fits its type ("Budget band" for "Budget band", "Phone" for "phone"):
 * the first publish's prefill.
 */
export function fileByLabel(document: FormDocument, attributes: readonly FormAttributeChoice[]): FormDocument {
  return { ...document, questions: list.fileByLabel(document.questions, attributes) };
}

/** The attributes the publish will create for the form's unfiled questions (`planNewAttributes` in the shared editor). */
export function planNewAttributes(
  document: FormDocument,
  attributes: readonly FormAttributeChoice[],
  isFiling: boolean,
): readonly PlannedAttribute[] {
  return list.planNewAttributes(document.questions, attributes, isFiling);
}

export { filedLine, fittingAttributes, type PlannedAttribute, type QuestionChange } from '../questions/questions.ts';

/** The target's attributes as the publish check reads them. */
export function publishAttributesOf(target: FormTargetChoices): ReadonlyMap<string, PublishAttribute> {
  return new Map(
    target.items.map((item) => [
      item.attributeId,
      {
        id: item.attributeId,
        title: item.title,
        type: item.type,
        objectName: target.objectName ?? '',
        canWrite: item.canWrite,
      },
    ]),
  );
}

/** The status line's tone and words. */
export function statusOf(
  form: Pick<FormView, 'status' | 'liveVersionNumber' | 'hasUnpublished'>,
  isChanged: boolean,
): { readonly tone: 'live' | 'changed' | 'draft' | 'paused'; readonly text: string } {
  if (form.liveVersionNumber === undefined) return { tone: 'draft', text: strings.statusDraft };
  if (form.status === 'paused') return { tone: 'paused', text: strings.statusPaused };
  // A draft saved since the last publish (a routing rule added and taken away, say) still has Publish changes beside
  // it, so the status says edited too rather than the live version alone (Q67).
  if (isChanged || form.hasUnpublished) return { tone: 'changed', text: strings.statusChanged };
  return { tone: 'live', text: strings.statusLive(form.liveVersionNumber) };
}

/** Whether two documents say the same thing (key order aside). */
export function sameDocument(a: FormDocument | undefined, b: FormDocument | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, each]) => each !== undefined)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([key, each]) => [key, sorted(each)]),
      );
    }
    return value;
  };
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

/**
 * Whether a web address is complete enough for "Another web page": https (http only for localhost, for local
 * testing), a host with a dot in it, at most 2,048 characters. As strict as the server's check or stricter, so the
 * draft never sends one the server refuses.
 */
export function isRedirectAddress(value: string): boolean {
  if (value.length > 2_048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hostname === 'localhost') return url.protocol === 'https:' || url.protocol === 'http:';
  return url.protocol === 'https:' && /^[^.]+(\.[^.]+)+$/.test(url.hostname);
}

/** What a Settings field still needs before the draft can hold it: the web address, or the button's words. */
export type DraftGap = 'redirect' | 'button';

/** The first field typed into but not yet complete, which neither saves nor publishes until it is. */
export function draftGap(document: FormDocument): DraftGap | undefined {
  if (document.after.kind === 'redirect' && !isRedirectAddress(document.after.url)) return 'redirect';
  if (document.buttonText.trim() === '') return 'button';
  return undefined;
}

/**
 * The draft as it can be saved: a field still being typed (a partial web address, empty button words) keeps what
 * the server holds, so every other change still saves, and the half typed field never comes back as a failed save.
 */
export function savableDraft(document: FormDocument, saved: FormDocument): FormDocument {
  const after =
    document.after.kind === 'redirect' && !isRedirectAddress(document.after.url) ? saved.after : document.after;
  const buttonText = document.buttonText.trim() === '' ? saved.buttonText : document.buttonText;
  return after === document.after && buttonText === document.buttonText ? document : { ...document, after, buttonText };
}

/**
 * What the first publish opens with: the form's name (blank while it is still "Untitled form") and an address made
 * from that name, or the form's own key when the name gives none, so a name given before Publish carries into it.
 */
export function publishStart(name: string, publicKey: string): { readonly name: string; readonly address: string } {
  const named = name === strings.untitledForm ? '' : name;
  const suggested = named.trim() === '' ? '' : slugFromName(named);
  return { name: named, address: FORM_SLUG.test(suggested) ? suggested : publicKey };
}
