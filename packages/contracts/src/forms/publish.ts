// The publish check (spec 0023, 0023-experience.md, Publishing; AC-546,
// AC-655): one function the builder and the server both run, answering the
// first problem with a draft as one full sentence and the question at fault.
// A draft save refuses a condition over a record field in the same words.
// Plain TypeScript: the caller hands in what it knows of the attributes.
import { CHOICE_TYPES, fitsAttribute, FORM_SLUG } from './answer-types.ts';
import type { AttributeType } from '../values/attribute-values.ts';
import type { FormDocument } from './document.ts';
import { stepsOfBreaks } from './breaks.ts';
import { isHiddenFact, isRecordFact } from './conditions.ts';
import { NUMBER_OPS, type Condition, type ShowWhen } from './show-when.ts';
import { recalledKeys, SCORE_FACT } from './recall.ts';
import {
  BRAND_HEX_PATTERN,
  brandVariables,
  CONTROL_CONTRAST,
  contrastRatio,
  DARK_SURFACES,
  LIGHT_SURFACES,
  TEXT_CONTRAST,
  type BrandAccent,
  type BrandSwatch,
} from '../brand-colour.ts';

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
    /** The endings a jump or a rule may name (spec 0063, AC-6315). */
    readonly endings?: FormDocument['endings'];
    /** Where the score is filed (AC-6316): checked like a question's filing. */
    readonly scoreFiledOn?: FormDocument['scoreFiledOn'];
    /** Its look (spec 0063, AC-6327): only `theme: 'brand'` makes the brand kit part of what publishes. */
    readonly look?: Pick<FormDocument['look'], 'theme'>;
  };
  /** The main object's live attributes, by id (archived and deleted ones absent). */
  readonly attributes: ReadonlyMap<string, PublishAttribute>;
  /**
   * The deal's live attributes, by id, when Also create a deal is on (forms fixes 2): a question filed on the deal is
   * checked against these, as one filed on the main record is against `attributes`. Absent: none are known, so a
   * question filed on the deal reads as filed on a field that no longer exists.
   */
  readonly dealAttributes?: ReadonlyMap<string, PublishAttribute>;
  /** The main object's name, for the sentences that name it; "People" when it isn't given. */
  readonly objectName?: string;
  /**
   * Whether the form adds people to the CRM: its main object is People (AC-1053). False refuses a Consent question,
   * which only a person can hold; absent (the builder, which doesn't know) checks nothing, and the server always
   * says.
   */
  readonly isPeople?: boolean;
  /**
   * Whether the publisher may change the object's attributes (`schema.manage`). Without it, an email the object
   * can't match on is something only a workspace admin can put right, so the sentence sends them to one instead of
   * telling them to file a question that is already filed (late trap #17).
   */
  readonly canChangeAttributes?: boolean;
  /**
   * The workspace's brand kit accent pair, when the form wears it (spec 0063, AC-6327): the server reads it from
   * `workspace_brands` on the publish path, and the builder from the kit it already holds, so both run spec 0060's
   * contrast guard over the same pair. Absent means the kit sets no colour, which is the product's own accent and
   * always readable.
   */
  readonly brand?: BrandAccent;
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
    | 'STEP_EMPTY'
    | 'JUMP_INVALID'
    | 'ENDING_INVALID'
    | 'RECALL_INVALID'
    | 'SCORE_FILING_INVALID'
    | 'BRAND_UNREADABLE'
    | 'CONSENT_INVALID';
  readonly message: string;
  readonly questionId?: string;
  /** The step at fault (spec 0063): its Show when, or nothing under it. */
  readonly stepId?: string;
  /** The routing rule at fault (spec 0043, AC-1605). */
  readonly ruleId?: string;
  /** The ending at fault (spec 0063, AC-6315): one a jump or a rule names, or whose words recall too late. */
  readonly endingId?: string;
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
    // The form's score (AC-6316) is worked out from the answers read so far, so any rule or jump may compare it.
    if (condition.key === SCORE_FACT) return undefined;
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
  if (NUMBER_OPS.includes(condition.op) && !['number', 'rating', 'scale'].includes(question.answerType)) {
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
  dealAttributes: ReadonlyMap<string, PublishAttribute> = new Map(),
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
    if (question.answerType === 'multi_select' && question.options?.min !== undefined) {
      const offered =
        (question.choices ?? []).filter((choice) => choice.trim() !== '').length +
        (question.options.other === true ? 1 : 0);
      if (question.options.min > offered) {
        return {
          code: 'CHOICES_MISSING',
          message: `${named(question)} asks for at least ${String(question.options.min)} picks but offers ${String(offered)}.`,
          questionId: question.id,
        };
      }
    }
    const filed = question.filedOn;
    if (filed === undefined) continue;
    const attribute = (filed.objectRole === 'deal' ? dealAttributes : attributes).get(filed.attributeId);
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
      question.filedOn?.objectRole !== 'main' ? [] : [question.filedOn.attributeId],
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
      // Named as the editor names it: an empty step is no step a visitor counts, so it has no number.
      const empty = step.title === undefined ? 'A new step' : `The step “${step.title}”`;
      return {
        code: 'STEP_EMPTY',
        message: `${empty} has no questions. Move a question under it, or remove the step.`,
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

/** An ending's name in a sentence: its heading, or its place while it has none. */
const endingNamed = (ending: { readonly heading: string }, index: number) =>
  ending.heading.trim() === '' ? `Ending ${String(index + 1)}` : `“${ending.heading.trim()}”`;

/**
 * The first problem with a form's jumps (spec 0063, AC-6313, AC-6326), or undefined: a jump to a step or an ending
 * the form no longer has, a jump backwards (which would let a visitor loop), and a jump whose conditions read an
 * answer that doesn't come before it. Only the layouts that draw jumps are checked: Steps carries them on its step
 * dividers, One at a time on its questions, and Classic shows everything at once, so it has nowhere to jump from.
 */
function jumpsProblem(input: PublishInput): PublishProblem | undefined {
  const { questions, layout, steps = [], endings = [] } = input.document;
  const all: Readable = new Map(questions.map((question) => [question.key, question]));
  const endingIds = new Set(endings.map((ending) => ending.id));
  const stepped = layout === 'steps';
  if (!stepped && layout !== 'conversational') return undefined;
  // One at a time asks one question per screen, so each question is a step named by its key (`groupsOf`).
  const resolved = stepped
    ? stepsOfBreaks(questions, steps).map((step, index) => ({
        id: step.id,
        keys: step.keys,
        name: stepNamed(step.title, index),
        jumps: steps.find((each) => each.id === step.id)?.jumps ?? [],
      }))
    : questions.map((question) => ({
        id: question.key,
        keys: [question.key],
        name: named(question),
        jumps: question.jumps ?? [],
      }));
  const placeOf = new Map(resolved.flatMap((step, index) => (step.id === undefined ? [] : [[step.id, index]])));
  const before = new Map<string, FormDocument['questions'][number]>();
  for (const [index, step] of resolved.entries()) {
    // A jump reads its own step's answers too: they are given before the jump decides.
    for (const key of step.keys) {
      const question = all.get(key);
      if (question !== undefined) before.set(key, question);
    }
    for (const jump of step.jumps) {
      const stepId = step.id;
      const where = stepId === undefined ? {} : stepped ? { stepId } : {};
      const reads = showWhenProblem(jump.when, before, all);
      if (reads !== undefined) {
        return {
          code: 'JUMP_INVALID',
          message: `${step.name} jumps on an answer that ${reads}. Change its Jumps.`,
          ...where,
        };
      }
      if ('ending' in jump.to) {
        if (!endingIds.has(jump.to.ending)) {
          return {
            code: 'JUMP_INVALID',
            message: `${step.name} jumps to an ending that is no longer on the form. Choose another in its Jumps.`,
            ...where,
          };
        }
        continue;
      }
      const to = placeOf.get(jump.to.step);
      if (to === undefined) {
        return {
          code: 'JUMP_INVALID',
          message: `${step.name} jumps to a step that is no longer on the form. Choose another in its Jumps.`,
          ...where,
        };
      }
      if (to <= index) {
        return {
          code: 'JUMP_INVALID',
          message: `${step.name} jumps back to ${resolved[to]?.name ?? 'an earlier step'}, which would send a visitor round in circles. Jumps only go forward.`,
          ...where,
        };
      }
    }
  }
  return undefined;
}

/** The first problem with a form's endings (AC-6315), or undefined: an ending with nothing at its head. */
function endingsProblem(input: PublishInput): PublishProblem | undefined {
  for (const [index, ending] of (input.document.endings ?? []).entries()) {
    if (ending.heading.trim() === '') {
      return {
        code: 'ENDING_INVALID',
        message: `Ending ${String(index + 1)} has no heading. Give it one, or remove the ending.`,
        endingId: ending.id,
      };
    }
  }
  return undefined;
}

/**
 * The first recall that can't be read (AC-6317), or undefined: a question's label or help line recalling itself, a
 * question that comes after it, or one the form no longer has, each as one sentence naming both. An ending's words
 * come after every question, so only a question that is gone is refused there. `{{score}}` is always readable.
 */
function recallProblem(input: PublishInput): PublishProblem | undefined {
  const { questions, endings = [] } = input.document;
  const all: Readable = new Map(questions.map((question) => [question.key, question]));
  const before = new Map<string, FormDocument['questions'][number]>();
  const unreadable = (text: string, readable: Readable) =>
    recalledKeys(text).find((key) => key.toLowerCase() !== SCORE_FACT && !readable.has(key));
  for (const question of questions) {
    const key = unreadable(question.label, before);
    before.set(question.key, question);
    if (key === undefined) continue;
    const later = all.get(key);
    return {
      code: 'RECALL_INVALID',
      message:
        later === undefined
          ? `${named(question)} recalls “${key}”, which is no longer a question on this form. Take it out of the label.`
          : `${named(question)} recalls ${named(later)}, which comes after it, so there is nothing to recall yet. Move it earlier, or take it out of the label.`,
      questionId: question.id,
    };
  }
  for (const [index, ending] of endings.entries()) {
    const key = unreadable(ending.heading, all) ?? unreadable(ending.line ?? '', all);
    if (key === undefined) continue;
    return {
      code: 'RECALL_INVALID',
      message: `${endingNamed(ending, index)} recalls “${key}”, which is no longer a question on this form. Take it out of the ending.`,
      endingId: ending.id,
    };
  }
  return undefined;
}

/**
 * Why a Consent question can't go live (AC-1053), or undefined: its words recall an answer, so each visitor would
 * agree to different words than the record keeps; or the form adds no person to the CRM, so there is nobody to
 * keep the consent on.
 */
function consentProblem(
  questions: readonly FormDocument['questions'][number][],
  isPeople: boolean | undefined,
): PublishProblem | undefined {
  for (const question of questions) {
    if (question.answerType !== 'consent') continue;
    if (recalledKeys(question.label).length > 0) {
      return {
        code: 'CONSENT_INVALID',
        message: `${named(question)} recalls an answer, so each visitor would agree to different words. Write the wording out in full.`,
        questionId: question.id,
      };
    }
    if (isPeople === false) {
      return {
        code: 'CONSENT_INVALID',
        message: `${named(question)} is a consent, and a consent is kept on a person. Add answers to People, or take it out.`,
        questionId: question.id,
      };
    }
  }
  return undefined;
}

/** Why the score can't be filed where it is pointed (AC-6316), or undefined: an attribute gone, not a number, or read only. */
function scoreFilingProblem(input: PublishInput): PublishProblem | undefined {
  const filed = input.document.scoreFiledOn;
  if (filed === undefined) return undefined;
  const attribute = input.attributes.get(filed.attributeId);
  if (attribute === undefined) {
    return {
      code: 'SCORE_FILING_INVALID',
      message: 'The score is filed on an attribute that no longer exists. Choose another, or file it nowhere.',
    };
  }
  if (attribute.type !== 'number') {
    return {
      code: 'SCORE_FILING_INVALID',
      message: `The score is filed on ${attribute.objectName} · ${attribute.title}, which doesn’t hold a number. Choose a number field, or file it nowhere.`,
    };
  }
  if (!attribute.canWrite) {
    return {
      code: 'SCORE_FILING_INVALID',
      message: `You can’t write to ${attribute.objectName} · ${attribute.title}, so this form can’t file its score there.`,
    };
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
/** Every pair spec 0060's guard promises of one mode's swatch, with the surfaces it has to hold on. */
function unreadableSwatch(swatch: BrandSwatch, surfaces: readonly string[]): boolean {
  if (contrastRatio(swatch.accent, swatch.onAccent) < TEXT_CONTRAST) return true;
  return surfaces.some(
    (surface) =>
      contrastRatio(swatch.link, surface) < TEXT_CONTRAST || contrastRatio(swatch.accent, surface) < CONTROL_CONTRAST,
  );
}

/**
 * Why a brand kit can't go on a public page (spec 0063, AC-6327; spec 0060, AC-5), as one sentence, or undefined.
 * Spec 0060's guard keeps every checked hex readable by moving its lightness, so a kit saved through `brand.save`
 * answers undefined here. What this catches is a pair that never went through that door: a colour that isn't a
 * checked six digit hex, or one the guard could not lift to AA on every surface. The form's publish path runs it
 * (`publishProblem`), so an unreadable pair is refused there and not only on the brand kit's own screen.
 */
export function unreadableBrand(brand: BrandAccent): string | undefined {
  const cannot = 'This form wears your brand colour, and it can’t be made readable. Change it in Settings › Brand.';
  for (const hex of [brand.accent, brand.accentDark]) {
    if (hex !== undefined && !BRAND_HEX_PATTERN.test(hex)) return cannot;
  }
  let colours;
  try {
    colours = brandVariables(brand);
  } catch {
    return cannot;
  }
  return unreadableSwatch(colours.light, LIGHT_SURFACES) || unreadableSwatch(colours.dark, DARK_SURFACES)
    ? cannot
    : undefined;
}

export function publishProblem(input: PublishInput): PublishProblem | undefined {
  if (input.name.trim() === '') return { code: 'NAME_MISSING', message: 'Give the form a name.' };
  if (!FORM_SLUG.test(input.slug)) {
    return { code: 'ADDRESS_INVALID', message: 'The address needs 2 to 40 lowercase letters, numbers or hyphens.' };
  }
  // The look before the questions: a brand the page could not be read in is about the whole form, not one answer.
  if (input.document.look?.theme === 'brand' && input.brand !== undefined) {
    const unreadable = unreadableBrand(input.brand);
    if (unreadable !== undefined) return { code: 'BRAND_UNREADABLE', message: unreadable };
  }
  const { questions, targets } = input.document;
  const consent = consentProblem(questions, input.isPeople);
  if (consent !== undefined) return consent;
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
    input.dealAttributes,
  );
  if (problem !== undefined) return problem;
  const steps = stepsProblem(input);
  if (steps !== undefined) return steps;
  // Logic last (spec 0063, AC-6326), in the order a member reads the form: its endings, its jumps, its recalls,
  // then where its score is filed.
  const endings = endingsProblem(input);
  if (endings !== undefined) return endings;
  const jumps = jumpsProblem(input);
  if (jumps !== undefined) return jumps;
  const recalled = recallProblem(input);
  if (recalled !== undefined) return recalled;
  const scored = scoreFilingProblem(input);
  if (scored !== undefined) return scored;
  const all: Readable = new Map(questions.map((question) => [question.key, question]));
  for (const [index, rule] of (input.document.routing?.rules ?? []).entries()) {
    const problem = showWhenProblem(rule.when, all, all, true);
    if (problem !== undefined) {
      return { code: 'ROUTING_INVALID', message: ruleMessage(rule, index, problem), ruleId: rule.id };
    }
    const route = rule.then;
    if (route.kind === 'ending' && !(input.document.endings ?? []).some((each) => each.id === route.endingId)) {
      return {
        code: 'ROUTING_INVALID',
        message: ruleMessage(rule, index, 'goes to an ending that is no longer on the form'),
        ruleId: rule.id,
      };
    }
    if (route.kind === 'hosts') {
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
  document: Pick<FormDocument, 'questions'> & {
    readonly routing?: FormDocument['routing'];
    readonly steps?: FormDocument['steps'];
  },
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
  // A step's Show when too (spec 0063): it is stored in the same draft every member reads.
  const steps = document.steps ?? [];
  const stepAt = steps.findIndex((each) => readsField(each.showWhen));
  const step = steps[stepAt];
  if (step !== undefined) {
    return {
      code: 'SHOW_WHEN_INVALID',
      message: `A step ${READS_RECORD_FIELD}. Change its Show when.`,
      stepId: step.id,
    };
  }
  const rules = document.routing?.rules ?? [];
  const index = rules.findIndex((rule) => readsField(rule.when));
  const rule = rules[index];
  if (rule === undefined) return undefined;
  return { code: 'ROUTING_INVALID', message: ruleMessage(rule, index, READS_RECORD_FIELD), ruleId: rule.id };
}
