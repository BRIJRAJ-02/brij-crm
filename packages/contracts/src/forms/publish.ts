// The publish check (spec 0023, 0023-experience.md, Publishing; AC-546,
// AC-655): one function the builder and the server both run, answering the
// first problem with a draft as one full sentence and the question at fault.
// A draft save refuses a condition over a record field in the same words.
// Plain TypeScript: the caller hands in what it knows of the attributes.
import { CHOICE_TYPES, fitsAttribute, FORM_SLUG } from './answer-types.ts';
import type { AttributeType } from '../values/attribute-values.ts';
import type { FormDocument } from './document.ts';
import { isHiddenFact, isRecordFact, NUMBER_OPS, type Condition, type ShowWhen } from './show-when.ts';

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

/** A rule's name in a sentence: "Rule 2", or "Rule 2, “Enterprise”," when it has a name. */
const ruleNamed = (rule: { readonly name?: string | undefined }, index: number) =>
  rule.name === undefined || rule.name === ''
    ? `Rule ${String(index + 1)}`
    : `Rule ${String(index + 1)}, “${rule.name}”,`;

/** What a condition over a person's or a company's field is refused for, on publish and on save alike. */
const READS_RECORD_FIELD = 'reads a record field, which only a team page’s rules can read';

/** The refusal of a question's Show when: the question, the problem, and where to change it. */
const showWhenMessage = (question: { readonly label: string; readonly key: string }, problem: string) =>
  `${named(question)} ${problem}. Change its Show when.`;

/** The refusal of a routing rule: the rule, the problem, and where to change it. */
const ruleMessage = (rule: { readonly name?: string | undefined }, index: number, problem: string) =>
  `${ruleNamed(rule, index)} ${problem}. Change it in Routing.`;

/** What a condition may read: the questions before it, by key. */
type Readable = ReadonlyMap<string, FormDocument['questions'][number]>;

/**
 * Why one condition can't stand (spec 0043, AC-1605; spec 0023, AC-1038), as
 * the end of a sentence, or undefined: a question that isn't before it (or a
 * record field, which a form's rules don't read), a choice that no longer
 * exists, a number comparison on a question that isn't a number. A routing
 * rule (`isRule`) may also read the visit's hidden fields (its UTM tags, page
 * and referrer) as text; a question's Show when may not, since the hosted
 * page decides what shows from answers alone.
 */
function conditionProblem(
  condition: Condition,
  readable: Readable,
  all: Readable,
  isRule: boolean,
): string | undefined {
  const question = readable.get(condition.key);
  if (question === undefined) {
    if (isRecordFact(condition.key)) return READS_RECORD_FIELD;
    if (isHiddenFact(condition.key)) {
      if (!isRule) return 'reads a hidden field such as a UTM tag, which only routing rules can read';
      return NUMBER_OPS.includes(condition.op) ? 'compares a hidden field as a number, but it holds text' : undefined;
    }
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

/** The first problem among a Show when's conditions, or a routing rule's (`isRule`). */
function showWhenProblem(
  showWhen: ShowWhen | undefined,
  readable: Readable,
  all: Readable,
  isRule = false,
): string | undefined {
  for (const condition of showWhen?.rules ?? []) {
    const problem = conditionProblem(condition, readable, all, isRule);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * The first problem with a list of questions, or undefined: a Show when that reads what it can't, a missing label, a
 * choice question with nothing to choose, a file question, and filing onto an attribute that is gone, doesn't fit or
 * the writer can't write. A form's publish asks it (with its target's match attribute, whose email question always
 * shows) and a booking page's save too (spec 0057), so a question breaks the same way on both.
 */
export function questionsProblem(
  questions: readonly FormDocument['questions'][number][],
  attributes: ReadonlyMap<string, PublishAttribute>,
  target?: { readonly matchAttributeId?: string | undefined },
): PublishProblem | undefined {
  const all: Readable = new Map(questions.map((question) => [question.key, question]));
  const before = new Map<string, FormDocument['questions'][number]>();
  for (const question of questions) {
    const hidden = showWhenProblem(question.showWhen, before, all);
    before.set(question.key, question);
    if (hidden !== undefined) {
      return { code: 'SHOW_WHEN_INVALID', message: showWhenMessage(question, hidden), questionId: question.id };
    }
    if (
      question.showWhen !== undefined &&
      target !== undefined &&
      target.matchAttributeId === question.filedOn?.attributeId &&
      question.answerType === 'email'
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
    const attribute = attributes.get(filed.attributeId);
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
  const problem = questionsProblem(
    questions,
    input.attributes,
    targets.main === undefined ? undefined : { matchAttributeId: targets.main.matchAttributeId },
  );
  if (problem !== undefined) return problem;
  const all: Readable = new Map(questions.map((question) => [question.key, question]));
  for (const [index, rule] of (input.document.routing?.rules ?? []).entries()) {
    const problem = showWhenProblem(rule.when, all, all, true);
    if (problem !== undefined) {
      return { code: 'ROUTING_INVALID', message: ruleMessage(rule, index, problem), ruleId: rule.id };
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

/**
 * The first question whose Show when, or else the first routing rule, reads a person's or a company's field, in
 * the words `publishProblem` refuses it with, or undefined. A form's conditions read its answers and the visit's
 * hidden fields only: its editor never offers a record field, and only a team page's rules read one. The draft save
 * refuses one too (security review, 23 October 2026): every member who sees a form reads its draft, so a stored
 * condition would show them a field's id and the value it looks for, even a field hidden from them.
 */
export function recordFactProblem(
  document: Pick<FormDocument, 'questions'> & { readonly routing?: FormDocument['routing'] },
): PublishProblem | undefined {
  const readsField = (showWhen: ShowWhen | undefined) =>
    (showWhen?.rules ?? []).some((condition) => isRecordFact(condition.key));
  const question = document.questions.find((each) => readsField(each.showWhen));
  if (question !== undefined) {
    return {
      code: 'SHOW_WHEN_INVALID',
      message: showWhenMessage(question, READS_RECORD_FIELD),
      questionId: question.id,
    };
  }
  const rules = document.routing?.rules ?? [];
  const index = rules.findIndex((rule) => readsField(rule.when));
  const rule = rules[index];
  if (rule === undefined) return undefined;
  return { code: 'ROUTING_INVALID', message: ruleMessage(rule, index, READS_RECORD_FIELD), ruleId: rule.id };
}
