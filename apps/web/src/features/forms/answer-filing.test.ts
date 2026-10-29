import type { SubmissionAnswer } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { answerFiling, notSavedReasons } from './answer-filing.ts';
import { strings } from './strings.ts';

const ATTRIBUTE = '0199f0a0-0000-7000-8000-00000000000a';

const answer = (questionId: string, isFiled: boolean): SubmissionAnswer => ({
  questionId,
  key: questionId,
  label: questionId,
  answerType: 'short_text',
  value: 'x',
  ...(isFiled ? { attributeId: ATTRIBUTE } : {}),
});

const record = { objectId: ATTRIBUTE, recordId: ATTRIBUTE, name: 'Grace Hopper', objectName: 'People' } as never;

describe('how a submission says which answers went to the CRM', () => {
  it('says once that a form keeping its submissions files nothing, and marks no answer', () => {
    const filing = answerFiling([answer('a', false)], { state: 'not_in_crm', canAddToCrm: false }, false);
    expect(filing).toEqual({ note: strings.answersKeptOnly, marked: new Set(), mark: '' });
  });

  it('leaves the line to Records while the job files it', () => {
    expect(answerFiling([answer('a', true)], { state: 'filing' }, true)).toEqual({ marked: new Set(), mark: '' });
  });

  it('says a submission not in the CRM keeps its answers', () => {
    const filing = answerFiling([answer('a', true)], { state: 'not_in_crm', canAddToCrm: true }, true);
    expect(filing.note).toBe(strings.answersNotInCrm);
    expect(filing.marked.size).toBe(0);
  });

  it('marks the answers not saved, whichever group is larger', () => {
    const most = answerFiling(
      [answer('name', true), answer('email', true), answer('budget', false)],
      { state: 'linked', record },
      true,
    );
    expect(most.note).toBe('2 of 3 saved on the record');
    expect([...most.marked]).toEqual(['budget']);
    expect(most.mark).toBe(strings.notSavedMark);
    const few = answerFiling(
      [answer('email', true), answer('size', false), answer('budget', false)],
      { state: 'linked', record },
      true,
    );
    expect(few.note).toBe('1 of 3 saved on the record');
    expect([...few.marked]).toEqual(['size', 'budget']);
    expect(few.mark).toBe(strings.notSavedMark);
  });

  it('marks nothing when every answer was saved', () => {
    const filing = answerFiling([answer('a', true)], { state: 'linked', record }, true);
    expect(filing).toEqual({ note: strings.answersAllSaved, marked: new Set(), mark: '' });
  });

  it('counts an answer filing refused or skipped as not saved, though it names a field (late trap #50)', () => {
    const filing = answerFiling([answer('name', true), answer('title', true)], { state: 'linked', record }, true, [
      { questionId: 'title' },
    ]);
    expect(filing.note).toBe('1 of 2 saved on the record');
    expect([...filing.marked]).toEqual(['title']);
  });

  it('groups the refused answers by reason, so one cause reads as one line', () => {
    const answers = [answer('name', true), answer('title', true), answer('budget', true)];
    expect(
      notSavedReasons(answers, [
        { questionId: 'title', message: 'The record couldn’t be written.' },
        { questionId: 'budget', message: 'The record couldn’t be written.' },
        { questionId: 'gone', message: 'Its field was deleted.' },
      ]),
    ).toEqual([{ message: 'The record couldn’t be written.', labels: ['title', 'budget'] }]);
  });
});
