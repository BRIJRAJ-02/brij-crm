// The one answer check (spec 0023, AC-553, AC-556): the hosted page runs it
// before it posts, and the submit endpoint runs it again on the published
// version, so a visitor sees the error the server would give. Required
// answers, the attribute type's parse, the question's options, and the
// attribute's validation rules (spec 0013's `checkRules`, keyed by question
// id); unknown fields are dropped. Pure: the pattern engine is passed in.
import { parseAttributeValue } from '../values/attribute-values.ts';
import { checkRules, type PatternCompiler, type RuleAttribute, type ValidationRule } from '../validation/check.ts';
import type { RuleKindName } from '../validation/kinds.ts';
import type { PublicBlock, PublicQuestion } from './public.ts';
import { formStrings, type FormStrings } from './strings.ts';
import type { FormLanguage } from './public.ts';

/** What the check needs from the form: its blocks and its language. */
export interface AnswerForm {
  readonly language: FormLanguage;
  readonly steps: readonly { readonly blocks: readonly PublicBlock[] }[];
}

/** What the check needs besides: the pattern engine, and the clock rules with dates read (UTC when absent). */
export interface AnswerCheckOptions {
  readonly pattern: PatternCompiler;
  readonly now?: string;
  readonly timeZone?: string;
}

/** The outcome: the answers in their canonical shapes, by question id, or each failing question's message. */
export type AnswerCheck =
  | { readonly ok: true; readonly answers: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly fields: Readonly<Record<string, string>> };

/** True for an answer that says nothing: absent, null, blank text or an empty list. */
export function isEmptyAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((part) => isEmptyAnswer(part));
  }
  return false;
}

/** Every question of a form, in order. */
export function publicQuestions(form: Pick<AnswerForm, 'steps'>): readonly PublicQuestion[] {
  return form.steps.flatMap((step) => step.blocks.flatMap((block) => (block.kind === 'question' ? [block] : [])));
}

function checkOne(question: PublicQuestion, raw: unknown, strings: FormStrings): { value?: unknown; error?: string } {
  if (question.type === 'checkbox') {
    const ticked = raw === true;
    if (question.required && !ticked) return { error: strings.requiredCheckbox };
    return { value: ticked };
  }
  if (isEmptyAnswer(raw)) return question.required ? { error: strings.required } : {};
  const parsed = parseAttributeValue(question.type, raw, { allowMultiple: question.isMulti });
  if (!parsed.ok) return { error: parsed.error.message };
  if (parsed.value === null) return question.required ? { error: strings.required } : {};
  if (question.type === 'select') {
    const allowed = new Set((question.options ?? []).map((option) => option.id));
    const picked = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    if (!picked.every((id) => typeof id === 'string' && allowed.has(id))) return { error: strings.pickOption };
  }
  return { value: parsed.value };
}

/**
 * Checks a visitor's answers against a form: each question's answer parsed
 * to its type's canonical shape, required ones present, select answers among
 * the question's options, then the questions' rules over what was answered.
 * Answers to anything but a question of the form are dropped.
 */
export function checkAnswers(
  form: AnswerForm,
  answers: Readonly<Record<string, unknown>>,
  options: AnswerCheckOptions,
): AnswerCheck {
  const strings = formStrings(form.language);
  const questions = publicQuestions(form);
  const values: Record<string, unknown> = {};
  const fields: Record<string, string> = {};
  for (const question of questions) {
    const raw = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
    const result = checkOne(question, raw, strings);
    if (result.error !== undefined) fields[question.id] = result.error;
    else if (result.value !== undefined) values[question.id] = result.value;
  }
  // The rules, keyed by question id: each question stands in for its attribute.
  const rules: ValidationRule[] = questions.flatMap((question) =>
    (question.rules ?? []).map((rule) => ({
      id: rule.id,
      attributeId: question.id,
      kind: rule.kind as RuleKindName,
      params: rule.params,
      ...(rule.message === undefined ? {} : { message: rule.message }),
      position: rule.position,
    })),
  );
  if (rules.length > 0) {
    const attributes = new Map<string, RuleAttribute>(
      questions.map((question, position) => [
        question.id,
        {
          type: question.type,
          isMulti: question.isMulti,
          archived: false,
          title: question.label,
          visible: true,
          position,
          ...(question.options === undefined ? {} : { options: question.options }),
        },
      ]),
    );
    const answered = Object.keys(values).filter((id) => !Object.hasOwn(fields, id));
    const failures = checkRules({
      rules,
      attributes,
      values,
      written: new Set(answered),
      clock: { now: options.now ?? new Date().toISOString(), timeZone: options.timeZone ?? 'UTC', weekStart: 'monday' },
      pattern: options.pattern,
    });
    for (const failure of failures) {
      if (failure.attributeId !== undefined && !Object.hasOwn(fields, failure.attributeId)) {
        fields[failure.attributeId] = failure.message;
      }
    }
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, answers: values };
}
