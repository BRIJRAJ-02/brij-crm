// The publish check (spec 0023, 0023-experience.md, Publishing; AC-546,
// AC-655): one function the builder and the server both run, answering the
// first problem with a draft as one full sentence and the question at fault.
// A draft save refuses a condition over a record field in the same words.
// Plain TypeScript: the caller hands in what it knows of the attributes.
import { CHOICE_TYPES, fitsAttribute, FORM_SLUG } from './answer-types.ts';
import type { AttributeType } from '../values/attribute-values.ts';
import type { FormDocument } from './document.ts';
import { stepsOfBreaks } from './path.ts';
import { isHiddenFact, isRecordFact, NUMBER_OPS, type Condition, type ShowWhen } from './show-when.ts';

/** An attribute as the check needs it: its name, type, and whether the publisher may write it. */
export interface PublishAttribute {
  readonly id: string;
  readonly title: string;
  readonly type: AttributeType;
  /** The object's singular name, for "Person · Budget band". */
  readonly objectName: string;
  readonly canWrite: boolean;
  /**
   * The object refuses a record without it, and nothing else fills it (`isUnfillableRequired` in
   * `@crm/contracts/values`: no default, not a checkbox, and not a Current user default, which fills nothing for a
   * visitor). A form that never asks for it can't make a record at all, so publishing says so instead of letting
   * every submission fail (27 October 2026).
   */
  readonly isRequired?: boolean;
  /**
   * Whether the publisher may see this attribute. False for one hidden from them, which the check still counts —
   * a hidden required field stops every submission just the same — but never names (security review: the
   * refusal would otherwise tell them a field's title they have no access to). Absent means they may see it.
   */
  readonly canSee?: boolean;
}

/** What publishing checks. */
export interface PublishInput {
  readonly name: string;
  readonly slug: string;
  readonly document: Pick<FormDocument, 'questions' | 'targets'> & {
    readonly routing?: FormDocument['routing'];
    /** Steps are checked only with the Steps layout, the one that draws them (spec 0063). */
    readonly layout?: FormDocument['layout'];
    readonly steps?: FormDocument['steps'];
  };
  /** The main object's live attributes, by id (archived and deleted ones absent). */
  readonly attributes: ReadonlyMap<string, PublishAttribute>;
  /** The main object's name, for the sentences that name it; "People" when it isn't given. */
  readonly objectName?: string;
  /**
   * Whether the publisher may change the object's attributes (`schema.manage`). Without it, an email the object
   * can't match on is something only a workspace admin can put right, so the sentence sends them to one instead of
   * telling them to file a question that is already filed (late trap #17).
   */
  readonly canChangeAttributes?: boolean;
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
    | 'REQUIRED_MISSING'
    | 'SHOW_WHEN_INVALID'
    | 'ROUTING_INVALID'
    | 'STEP_EMPTY';
  readonly message: string;
  readonly questionId?: string;
  /** The step at fault (spec 0063): its Show when, or nothing under it. */
  readonly stepId?: string;
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
 * A field the object insists on that no question fills (27 October 2026, the owner: every submission failed with
 * "A required field isn't asked by this form"). Named here, before the form goes live, rather than once a visitor
 * has typed everything in.
 */
function requiredNotAsked(input: PublishInput): PublishProblem | undefined {
  if (input.document.targets.main === undefined) return undefined;
  const filled = new Set(
    input.document.questions.flatMap((question) =>
      question.filedOn === undefined ? [] : [question.filedOn.attributeId],
    ),
  );
  const missing = [...input.attributes.values()].filter(
    (attribute) => attribute.isRequired === true && !filled.has(attribute.id),
  );
  if (missing.length === 0) return undefined;
  const where = input.objectName ?? 'People';
  // Hidden means unnamed (spec 0009, AC-144): the publisher is told a field stops them, never which one.
  const named = missing.filter((attribute) => attribute.canSee !== false).map((attribute) => attribute.title);
  const hidden = missing.length - named.length;
  const subjects = [
    ...named,
    ...(hidden === 0 ? [] : [hidden === 1 ? 'one field you can’t see' : `${String(hidden)} fields you can’t see`]),
  ];
  const one = subjects.length === 1;
  const subject = one
    ? (subjects[0] ?? '')
    : `${subjects.slice(0, -1).join(', ')} and ${subjects[subjects.length - 1] ?? ''}`;
  // Only hidden fields: the publisher can do nothing about them themselves, so the sentence sends them to someone who can.
  const fix =
    named.length === 0
      ? `Ask a workspace admin to give ${one ? 'it a default' : 'them defaults'} or make ${one ? 'it' : 'them'} optional.`
      : one
        ? 'Add a question for it, or make the field optional.'
        : 'Add questions for them, or make the fields optional.';
  return {
    code: 'REQUIRED_MISSING',
    message: `${subject} ${one ? 'is' : 'are'} required on ${where}, and no question fills ${one ? 'it' : 'them'}, so no submission could become a record. ${fix}`,
  };
}

/**
 * Why an email question that is there doesn't match a submission to its record, said so it can be put right. Filed
 * on an email the object holds that isn't its match: the object's own unique email is named, or, with none, the
 * email has to become unique, which a publisher without `canChangeAttributes` asks a workspace admin for. Not
 * filed, on an object with no email at all: the same, an email has to exist first. Otherwise, file it on the object.
 */
function noMatchMessage(input: PublishInput, email: FormDocument['questions'][number], where: string): string {
  const why = 'It is how a submission finds the record it belongs to, instead of adding a new one each time.';
  const match = input.document.targets.main?.matchAttributeId;
  const matchAttribute = match === undefined ? undefined : input.attributes.get(match);
  if (matchAttribute !== undefined && matchAttribute.type === 'email' && matchAttribute.canSee !== false) {
    return `File the email question on ${where} · ${matchAttribute.title}. ${why}`;
  }
  const filed = email.filedOn === undefined ? undefined : input.attributes.get(email.filedOn.attributeId);
  const needsAdmin = input.canChangeAttributes === false;
  if (filed !== undefined && filed.type === 'email' && filed.canSee !== false) {
    return needsAdmin
      ? `${filed.title} on ${where} isn’t unique, so a submission can’t find the record it belongs to. Ask a workspace admin to make it unique.`
      : `Make ${filed.title} on ${where} unique. ${why}`;
  }
  const hasEmail = [...input.attributes.values()].some(
    // Hidden means absent: a hidden email is as good as none to this publisher.
    (attribute) => attribute.type === 'email' && attribute.canSee !== false,
  );
  if (!hasEmail && needsAdmin) {
    return `${where} has no email field to file the email question on. Ask a workspace admin to add one that is unique.`;
  }
  return `File the email question on ${where}. ${why}`;
}

/** A step's name in a sentence: "Step 2", or "Step 2, “About you”," when it has a title. */
const stepNamed = (title: string | undefined, index: number) =>
  title === undefined ? `Step ${String(index + 1)}` : `Step ${String(index + 1)}, “${title}”,`;

/**
 * The first problem with a Steps form's breaks (spec 0063, AC-6312), or undefined: a step with no question under it,
 * a step's Show when reading what isn't before it, and a step with a Show when holding the email a submission is
 * matched by, which always shows. Classic and One at a time draw no steps, so their breaks are never refused.
 */
function stepsProblem(input: PublishInput): PublishProblem | undefined {
  const { questions, targets, layout, steps = [] } = input.document;
  if (layout !== 'steps' || steps.length === 0) return undefined;
  const all: Readable = new Map(questions.map((question) => [question.key, question]));
  const resolved = stepsOfBreaks(questions, steps);
  const before = new Map<string, FormDocument['questions'][number]>();
  for (const [index, step] of resolved.entries()) {
    const name = stepNamed(step.title, index);
    if (step.id !== undefined && step.keys.length === 0) {
      return {
        code: 'STEP_EMPTY',
        message: `${name} has no questions. Move a question under it, or remove the step.`,
        stepId: step.id,
      };
    }
    const problem = showWhenProblem(step.showWhen, before, all);
    if (problem !== undefined && step.id !== undefined) {
      return { code: 'SHOW_WHEN_INVALID', message: `${name} ${problem}. Change its Show when.`, stepId: step.id };
    }
    const match = targets.main?.matchAttributeId;
    const email = step.keys
      .map((key) => all.get(key))
      .find(
        (question) =>
          question?.answerType === 'email' && match !== undefined && question.filedOn?.attributeId === match,
      );
    if (step.showWhen !== undefined && email !== undefined && step.id !== undefined) {
      return {
        code: 'SHOW_WHEN_INVALID',
        message: `${named(email)} is how a submission becomes a person, so its step always shows. Remove the Show when on Step ${String(index + 1)}.`,
        stepId: step.id,
      };
    }
    for (const key of step.keys) {
      const question = all.get(key);
      if (question !== undefined) before.set(key, question);
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
    const where = input.objectName ?? 'People';
    const emailQuestion = questions.find(
      (question) => question.answerType === 'email' && match !== undefined && question.filedOn?.attributeId === match,
    );
    if (emailQuestion === undefined) {
      // Three ways to have no match, and they are not the same thing to be told (the owner, 27 October 2026). The
      // old sentence said "Keep an email question" to someone looking straight at the email question they had, and
      // called every object a person.
      const anyEmail = questions.find((question) => question.answerType === 'email');
      if (anyEmail === undefined) {
        return {
          code: 'EMAIL_MISSING',
          message: `Add an email question. It is how a submission finds the ${where} record it belongs to, instead of adding a new one each time.`,
        };
      }
      return { code: 'EMAIL_MISSING', message: noMatchMessage(input, anyEmail, where), questionId: anyEmail.id };
    }
    if (!emailQuestion.required) {
      return {
        code: 'EMAIL_MISSING',
        message: `Make the email question one visitors must answer. It is how a submission finds the ${where} record it belongs to.`,
        questionId: emailQuestion.id,
      };
    }
  }
  const missing = requiredNotAsked(input);
  if (missing !== undefined) return missing;
  const problem = questionsProblem(
    questions,
    input.attributes,
    targets.main === undefined ? undefined : { matchAttributeId: targets.main.matchAttributeId },
  );
  if (problem !== undefined) return problem;
  const steps = stepsProblem(input);
  if (steps !== undefined) return steps;
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
