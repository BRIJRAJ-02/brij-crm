import type { SubmissionAnswer } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { answerFiling } from './answer-filing.ts';
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

  it('marks the few kept answers when most were saved on the record', () => {
    const filing = answerFiling(
      [answer('name', true), answer('email', true), answer('budget', false)],
      { state: 'linked', record },
      true,
    );
    expect(filing.note).toBe('2 of 3 saved on the record');
    expect([...filing.marked]).toEqual(['budget']);
    expect(filing.mark).toBe(strings.notSavedMark);
  });

  it('marks the few saved answers when most stay with the submission', () => {
    const filing = answerFiling(
      [answer('email', true), answer('size', false), answer('budget', false)],
      { state: 'linked', record },
      true,
    );
    expect(filing.note).toBe('1 of 3 saved on the record');
    expect([...filing.marked]).toEqual(['email']);
    expect(filing.mark).toBe(strings.savedMark);
  });

  it('marks nothing when every answer was saved', () => {
    const filing = answerFiling([answer('a', true)], { state: 'linked', record }, true);
    expect(filing).toEqual({ note: strings.answersAllSaved, marked: new Set(), mark: '' });
  });
});
