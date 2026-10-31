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

  it('adds a divider at the end, and the next question added goes under it', () => {
    const added = addStep(flow, 's3');
    expect(order(added)).toEqual(['a', 'b', '|s2', 'c', 'd', '|s3']);
    const withE = [...QUESTIONS, question('e')];
    expect(keepBreaks(QUESTIONS, withE, added.steps)).toEqual([
      { id: 's2', title: 'More', startsAt: 'c' },
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
    expect(questionsBefore(flow, 's2').map((each) => each.id)).toEqual(['a', 'b']);
  });
});
