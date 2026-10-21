// The publish check (spec 0023, 0023-experience.md, Publishing; AC-546,
// AC-655): one function the builder and the server both run, answering the
// first problem with a draft as one full sentence and the question at fault.
// Plain TypeScript: the caller hands in what it knows of the attributes.
import { CHOICE_TYPES, fitsAttribute, FORM_SLUG } from './answer-types.ts';
import type { AttributeType } from '../values/attribute-values.ts';
import type { FormDocument } from './document.ts';

/** An attribute as the check needs it: its name, type, and whether the publisher may write it. */
export interface PublishAttribute {
  readonly id: string;
  readonly title: string;
  readonly type: AttributeType;
  /** The object's singular name, for "Person · Budget band". */
  readonly objectName: string;
  readonly canWrite: boolean;
}

/** What publishing checks. */
export interface PublishInput {
  readonly name: string;
  readonly slug: string;
  readonly document: Pick<FormDocument, 'questions' | 'targets'>;
  /** The main object's live attributes, by id (archived and deleted ones absent). */
  readonly attributes: ReadonlyMap<string, PublishAttribute>;
}

/** The first problem: a stable code, the sentence, and the question it is about. */
export interface PublishProblem {
  readonly code:
    | 'NAME_MISSING'
    | 'ADDRESS_INVALID'
    | 'EMAIL_MISSING'
    | 'LABEL_MISSING'
    | 'CHOICES_MISSING'
    | 'FILING_GONE'
    | 'FILING_MISFIT'
    | 'FILING_FORBIDDEN'
    | 'FILE_LATER';
  readonly message: string;
  readonly questionId?: string;
}

/** A question's name in a sentence: its label, or its key while it has none. */
const named = (question: { readonly label: string; readonly key: string }) =>
  `“${question.label.trim() === '' ? question.key : question.label.trim()}”`;

/**
 * The first problem that stops a draft going live, or undefined when it can.
 * In order: the name, the address, an email question filed on the match
 * attribute (how an enquiry becomes a person), each question's label, choices
 * and filing (gone, a type that doesn't fit, or an attribute the publisher
 * can't write), and file questions, which wait for file attachments (#32).
 */
export function publishProblem(input: PublishInput): PublishProblem | undefined {
  if (input.name.trim() === '') return { code: 'NAME_MISSING', message: 'Give the form a name.' };
  if (!FORM_SLUG.test(input.slug)) {
    return { code: 'ADDRESS_INVALID', message: 'The address needs 2 to 40 lowercase letters, numbers or hyphens.' };
  }
  const { questions, targets } = input.document;
  const match = targets.main.matchAttributeId;
  const emailQuestion = questions.find(
    (question) => question.answerType === 'email' && match !== undefined && question.filedOn?.attributeId === match,
  );
  if (emailQuestion === undefined) {
    return {
      code: 'EMAIL_MISSING',
      message: 'Keep an email question. It is how a submission becomes a person in Timefix.',
    };
  }
  if (!emailQuestion.required) {
    return {
      code: 'EMAIL_MISSING',
      message: 'Make the email question one visitors must answer. It is how a submission becomes a person in Timefix.',
      questionId: emailQuestion.id,
    };
  }
  for (const question of questions) {
    if (question.label.trim() === '') {
      return { code: 'LABEL_MISSING', message: 'Every question needs a label.', questionId: question.id };
    }
    if (
      CHOICE_TYPES.includes(question.answerType) &&
      (question.choices ?? []).every((choice) => choice.trim() === '')
    ) {
      return {
        code: 'CHOICES_MISSING',
        message: `${named(question)} is a choice question with nothing to choose from.`,
        questionId: question.id,
      };
    }
    if (question.answerType === 'file') {
      return {
        code: 'FILE_LATER',
        message: `${named(question)} asks for a file, which forms take once file attachments arrive. Choose another answer type.`,
        questionId: question.id,
      };
    }
    const filed = question.filedOn;
    if (filed === undefined) continue;
    const attribute = input.attributes.get(filed.attributeId);
    if (attribute === undefined) {
      return {
        code: 'FILING_GONE',
        message: `${named(question)} is filed on an attribute that no longer exists. Choose another in Where it goes, or Not filed.`,
        questionId: question.id,
      };
    }
    if (!fitsAttribute(question.answerType, attribute.type)) {
      return {
        code: 'FILING_MISFIT',
        message: `${named(question)} is filed on ${attribute.objectName} · ${attribute.title}, which takes another kind of answer. Choose another in Where it goes, or Not filed.`,
        questionId: question.id,
      };
    }
    if (!attribute.canWrite) {
      return {
        code: 'FILING_FORBIDDEN',
        message: `You can't write to ${attribute.objectName} · ${attribute.title}, so this form can't file answers there.`,
        questionId: question.id,
      };
    }
  }
  return undefined;
}
