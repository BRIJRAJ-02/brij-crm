import type { FormQuestion } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  addStep,
  changeStep,
  itemsOf,
  keepBreaks,
  moveItem,
  questionsBefore,
  removeStep,
  restoreStep,
  stepPlaces,
  isContactQuestion,
  isFirstStep,
  splitAt,
  splitIntoSteps,
  startsAStep,
  type Flow,
} from './steps.ts';

const question = (id: string): FormQuestion => ({
  id,
  key: id,
  label: id,
  answerType: 'short_text',
  required: false,
  update: 'fill',
});

const QUESTIONS = ['a', 'b', 'c', 'd'].map(question);
const flow: Flow = { questions: QUESTIONS, steps: [{ id: 's2', title: 'More', startsAt: 'c' }] };
const order = (next: Flow) => itemsOf(next).map((item) => (item.kind === 'step' ? `|${item.id}` : item.id));

describe('a form’s New step dividers (spec 0063, AC-6303)', () => {
  it('puts each divider just before the question it starts at, and one at the end last', () => {
    expect(order({ ...flow, steps: [...flow.steps, { id: 's3' }] })).toEqual(['a', 'b', '|s2', 'c', 'd', '|s3']);
  });

  it('drags a divider like a question: it starts at the question after its new place', () => {
    const moved = moveItem(flow, 's2', 1);
    expect(order(moved)).toEqual(['a', '|s2', 'b', 'c', 'd']);
    expect(moved.steps).toEqual([{ id: 's2', title: 'More', startsAt: 'b' }]);
    expect(moveItem(flow, 's2', 4).steps).toEqual([{ id: 's2', title: 'More' }]);
  });

  it('moves a question across a divider into the other step', () => {
    const moved = moveItem(flow, 'a', 2);
    expect(order(moved)).toEqual(['b', '|s2', 'a', 'c', 'd']);
    expect(moved.steps[0]?.startsAt).toBe('a');
  });

  it('adds a divider that splits the last step in two, so the new step already holds questions (T15)', () => {
    expect(order(addStep({ questions: QUESTIONS, steps: [] }, 's2'))).toEqual(['a', 'b', '|s2', 'c', 'd']);
    expect(order(addStep(flow, 's3'))).toEqual(['a', 'b', '|s2', 'c', '|s3', 'd']);
    expect(order(addStep({ questions: QUESTIONS.slice(0, 3), steps: [] }, 's2'))).toEqual(['a', 'b', '|s2', 'c']);
  });

  it('adds a divider at the end when the last step has one question or none, and the next question goes under it', () => {
    const one: Flow = { questions: QUESTIONS, steps: [{ id: 's2', startsAt: 'd' }] };
    const added = addStep(one, 's3');
    expect(order(added)).toEqual(['a', 'b', 'c', '|s2', 'd', '|s3']);
    const withE = [...QUESTIONS, question('e')];
    expect(keepBreaks(QUESTIONS, withE, added.steps)).toEqual([
      { id: 's2', startsAt: 'd' },
      { id: 's3', startsAt: 'e' },
    ]);
  });

  it('removes a divider, merging its questions into the step above, and Undo puts it back', () => {
    const { flow: without, removed } = removeStep(flow, 's2');
    expect(order(without)).toEqual(['a', 'b', 'c', 'd']);
    expect(removed).toEqual({ step: flow.steps[0], index: 0 });
    expect(order(restoreStep(without, flow.steps[0] ?? { id: 'x' }, 0))).toEqual(['a', 'b', '|s2', 'c', 'd']);
  });

  it('moves a divider whose question was deleted to the next question, or to the end', () => {
    expect(
      keepBreaks(
        QUESTIONS,
        QUESTIONS.filter((each) => each.id !== 'c'),
        flow.steps,
      ),
    ).toEqual([{ id: 's2', title: 'More', startsAt: 'd' }]);
    expect(keepBreaks(QUESTIONS, QUESTIONS.slice(0, 2), flow.steps)).toEqual([{ id: 's2', title: 'More' }]);
  });

  it('changes a title, a blank one being none, and a Show when', () => {
    const showWhen = { join: 'all' as const, rules: [{ key: 'a', op: 'is_answered' as const }] };
    expect(changeStep(flow, 's2', { title: '' }).steps).toEqual([{ id: 's2', startsAt: 'c' }]);
    expect(changeStep(flow, 's2', { showWhen }).steps[0]?.showWhen).toEqual(showWhen);
    expect(changeStep(changeStep(flow, 's2', { showWhen }), 's2', { showWhen: null }).steps[0]).toEqual(flow.steps[0]);
  });

  it('numbers each divider as a visitor counts its step, with what it holds', () => {
    expect(stepPlaces(flow).get('s2')).toEqual({ number: 2, count: 2 });
    expect(stepPlaces(moveItem(flow, 's2', 0)).get('s2')).toEqual({ number: 1, count: 4 });
    // One with nothing under it yet is no step a visitor counts.
    expect(stepPlaces({ ...flow, steps: [...flow.steps, { id: 's3' }] }).get('s3')).toEqual({ number: 0, count: 0 });
    expect(questionsBefore(flow, 's2').map((each) => each.id)).toEqual(['a', 'b']);
  });
});

describe('Steps as pages (T20, 5 November 2026)', () => {
  const ids = () => {
    let next = 0;
    return () => {
      next += 1;
      return `n${String(next)}`;
    };
  };
  const typed = (id: string, answerType: FormQuestion['answerType'], label = id): FormQuestion => ({
    ...question(id),
    answerType,
    label,
  });
  const words = { details: 'Your details' };

  it('splits after the contact details, titled, and gives the first page a header', () => {
    const questions = [
      typed('name', 'short_text', 'Your name'),
      typed('email', 'email'),
      typed('phone', 'phone'),
      typed('role', 'choice', 'Which role?'),
      typed('cv', 'file'),
    ];
    const split = splitIntoSteps({ questions, steps: [] }, ids(), words);
    expect(order(split)).toEqual(['|n1', 'name', 'email', 'phone', '|n2', 'role', 'cv']);
    expect(split.steps[0]).toEqual({ id: 'n1', startsAt: 'name', title: 'Your details' });
    expect(split.steps[1]).toEqual({ id: 'n2', startsAt: 'role' });
  });

  it('splits in the middle when nothing is contact detail, and leaves one question as one page', () => {
    expect(order(splitIntoSteps({ questions: QUESTIONS, steps: [] }, ids(), words))).toEqual([
      '|n1',
      'a',
      'b',
      '|n2',
      'c',
      'd',
    ]);
    expect(order(splitIntoSteps({ questions: QUESTIONS.slice(0, 1), steps: [] }, ids(), words))).toEqual(['|n1', 'a']);
    expect(splitIntoSteps({ questions: [], steps: [] }, ids(), words).steps).toEqual([]);
  });

  it('keeps breaks a form already has, adding only the first page’s header', () => {
    expect(order(splitIntoSteps(flow, ids(), words))).toEqual(['|n1', 'a', 'b', '|s2', 'c', 'd']);
    const headed = splitIntoSteps(flow, ids(), words);
    expect(splitIntoSteps(headed, ids(), words)).toBe(headed);
  });

  it('splits at a question, and knows which questions start a page and which break is first', () => {
    const split = splitAt(flow, 'd', 'n1');
    expect(order(split)).toEqual(['a', 'b', '|s2', 'c', '|n1', 'd']);
    expect(splitAt(split, 'd', 'n2')).toBe(split);
    expect(startsAStep(split, 'd')).toBe(true);
    expect(startsAStep(split, 'b')).toBe(false);
    expect(startsAStep(split, 'a')).toBe(true);
    const headed = splitIntoSteps(flow, ids(), words);
    expect(isFirstStep(headed, 'n1')).toBe(true);
    expect(isFirstStep(headed, 's2')).toBe(false);
  });

  it('calls email, phone and a name or company question contact detail', () => {
    expect(isContactQuestion(typed('x', 'email'))).toBe(true);
    expect(isContactQuestion(typed('x', 'short_text', 'Company name'))).toBe(true);
    expect(isContactQuestion(typed('x', 'short_text', 'What do you need?'))).toBe(false);
    expect(isContactQuestion(typed('x', 'choice', 'Your name'))).toBe(false);
  });
});
