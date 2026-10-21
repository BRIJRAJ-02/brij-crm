// The publish check (spec 0023, 0023-experience.md, Publishing; AC-546,
// AC-655): one function the builder and the server both run, answering the
// first problem with a draft as one full sentence and the question at fault.
// Plain TypeScript: the caller hands in what it knows of the attributes.
import { CHOICE_TYPES, fitsAttribute, FORM_SLUG } from './answer-types.ts';
import type { AttributeType } from '../values/attribute-values.ts';
import type { FormDocument } from './document.ts';
import { isRecordFact, NUMBER_OPS, type Condition, type ShowWhen } from './show-when.ts';

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
  readonly document: Pick<FormDocument, 'questions' | 'targets'> & { readonly routing?: FormDocument['routing'] };
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
    | 'FILE_LATER'
    | 'SHOW_WHEN_INVALID'
    | 'ROUTING_INVALID';
  readonly message: string;
  readonly questionId?: string;
  /** The routing rule at fault (spec 0043, AC-1605). */
  readonly ruleId?: string;
}

/** A question's name in a sentence: its label, or its key while it has none. */
const named = (question: { readonly label: string; readonly key: string }) =>
  `“${question.label.trim() === '' ? question.key : question.label.trim()}”`;

/** What a condition may read: the questions before it, by key. */
type Readable = ReadonlyMap<string, FormDocument['questions'][number]>;

/**
 * Why one condition can't stand (spec 0043, AC-1605; spec 0023, AC-1038), as
 * the end of a sentence, or undefined: a question that isn't before it (or a
 * record field, which a form's rules don't read), a choice that no longer
 * exists, a number comparison on a question that isn't a number.
 */
function conditionProblem(condition: Condition, readable: Readable, all: Readable): string | undefined {
  const question = readable.get(condition.key);
  if (question === undefined) {
    if (isRecordFact(condition.key)) return 'reads a record field, which only a team page’s rules can read';
    const later = all.get(condition.key);
    return later === undefined
      ? 'reads a question that is no longer on the form'
      : `reads ${named(later)}, which comes after it`;
  }
  if (NUMBER_OPS.includes(condition.op) && question.answerType !== 'number') {
    return `compares ${named(question)} as a number, but it isn’t a number question`;
  }
  if (
    CHOICE_TYPES.includes(question.answerType) &&
    condition.value !== undefined &&
    !NUMBER_OPS.includes(condition.op)
  ) {
    const values = typeof condition.value === 'string' ? [condition.value] : condition.value;
    const choices = new Set((question.choices ?? []).map((choice) => choice.trim().toLowerCase()));
    const gone =
      condition.op === 'contains' ? undefined : values.find((value) => !choices.has(value.trim().toLowerCase()));
    if (gone !== undefined) return `looks for “${gone}” in ${named(question)}, which is no longer one of its choices`;
  }
  return undefined;
}

/** The first problem among a Show when's conditions. */
function showWhenProblem(showWhen: ShowWhen | undefined, readable: Readable, all: Readable): string | undefined {
  for (const condition of showWhen?.rules ?? []) {
    const problem = conditionProblem(condition, readable, all);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * The first problem that stops a draft going live, or undefined when it can.
 * In order: the name, the address, an email question filed on the match
 * attribute (how a submission becomes a person; not asked of a form that
 * keeps its submissions only), each question's label, choices
 * and filing (gone, a type that doesn't fit, or an attribute the publisher
 * can't write), and file questions, which wait for file attachments (#32).
 */
export function publishProblem(input: PublishInput): PublishProblem | undefined {
  if (input.name.trim() === '') return { code: 'NAME_MISSING', message: 'Give the form a name.' };
  if (!FORM_SLUG.test(input.slug)) {
    return { code: 'ADDRESS_INVALID', message: 'The address needs 2 to 40 lowercase letters, numbers or hyphens.' };
  }
  const { questions, targets } = input.document;
  if (targets.main !== undefined) {
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
        message:
          'Make the email question one visitors must answer. It is how a submission becomes a person in Timefix.',
        questionId: emailQuestion.id,
      };
    }
  }
  const all: Readable = new Map(questions.map((question) => [question.key, question]));
  const before = new Map<string, FormDocument['questions'][number]>();
  for (const question of questions) {
    const hidden = showWhenProblem(question.showWhen, before, all);
    before.set(question.key, question);
    if (hidden !== undefined) {
      return {
        code: 'SHOW_WHEN_INVALID',
        message: `${named(question)} ${hidden}. Change its Show when.`,
        questionId: question.id,
      };
    }
    if (
      question.showWhen !== undefined &&
      targets.main?.matchAttributeId === question.filedOn?.attributeId &&
      question.answerType === 'email' &&
      targets.main !== undefined
    ) {
      return {
        code: 'SHOW_WHEN_INVALID',
        message: `${named(question)} is how a submission becomes a person, so it always shows. Remove its Show when.`,
        questionId: question.id,
      };
    }
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
  for (const [index, rule] of (input.document.routing?.rules ?? []).entries()) {
    const problem = showWhenProblem(rule.when, all, all);
    if (problem !== undefined) {
      const name =
        rule.name === undefined || rule.name === ''
          ? `Rule ${String(index + 1)}`
          : `Rule ${String(index + 1)}, “${rule.name}”,`;
      return { code: 'ROUTING_INVALID', message: `${name} ${problem}. Change it in Routing.`, ruleId: rule.id };
    }
    if (rule.then.kind === 'hosts') {
      return {
        code: 'ROUTING_INVALID',
        message: `Rule ${String(index + 1)} picks people without a booking page. Choose a booking page for it.`,
        ruleId: rule.id,
      };
    }
  }
  return undefined;
}
