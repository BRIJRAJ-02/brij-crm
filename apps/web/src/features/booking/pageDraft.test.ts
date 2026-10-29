// The booking page editor's draft after a save (Q61): Pause or Resume from the ⋯ menu saves `status` alone, outside
// the draft, and must not leave the old status behind as an unsaved change (the bar stayed up, and Save sent a page
// just paused live again); the person's own unsaved changes stay on top of any save.
import type { BookingPageSettings } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { changed, draftAfterSave } from './pageDraft.ts';

/** The fields these cases touch; the rest of the settings don't matter here. */
const settings = (changes: Partial<BookingPageSettings> = {}): BookingPageSettings =>
  ({ title: 'Demo', description: '', status: 'live', windowDays: 60, ...changes }) as unknown as BookingPageSettings;

describe('the draft once a save lands', () => {
  it('takes a pause as saved, so nothing reads as unsaved', () => {
    const before = settings();
    const next = settings({ status: 'paused' });
    const draft = draftAfterSave(next, before);
    expect(draft.status).toBe('paused');
    expect(changed(next, draft)).toEqual({});
  });

  it('takes a resume as saved too', () => {
    const next = settings({ status: 'live' });
    expect(changed(next, draftAfterSave(next, settings({ status: 'paused' })))).toEqual({});
  });

  it('keeps the person’s other unsaved changes through a pause', () => {
    const before = settings({ title: 'Demo, edited' });
    const next = settings({ status: 'paused' });
    expect(changed(next, draftAfterSave(next, before))).toEqual({ title: 'Demo, edited' });
  });

  it('clears what a group save sent, and keeps what changed while it was out', () => {
    const sent = { title: 'Demo, edited' };
    const next = settings(sent);
    const current = settings({ ...sent, windowDays: 30 });
    expect(changed(next, draftAfterSave(next, current))).toEqual({ windowDays: 30 });
  });

  it('keeps typing done while the save was out, as an unsaved change', () => {
    const next = settings({ title: 'A' });
    const current = settings({ title: 'AB' });
    expect(changed(next, draftAfterSave(next, current))).toEqual({ title: 'AB' });
  });
});

describe('a question filed onto a field Save just made (crm-f7, 28 Oct 2026)', () => {
  const attributeId = '0199f0a0-0000-7000-8000-0000000000a7';
  // As the server answers it: the schema's order, `filedOn` before `update`.
  const asSaved = {
    id: '0199f0a0-0000-7000-8000-000000000001',
    key: 'company',
    label: 'Company',
    answerType: 'short_text',
    required: false,
    filedOn: { objectRole: 'main', attributeId },
    update: 'fill',
  };
  // As the editor holds it once `changeQuestion` filed it: the same values, `filedOn` moved to the end.
  const asFiled = {
    id: asSaved.id,
    key: 'company',
    label: 'Company',
    answerType: 'short_text',
    required: false,
    update: 'fill',
    filedOn: { attributeId, objectRole: 'main' },
  };

  it('reads as saved, so the bar clears and leaving the page asks nothing', () => {
    // The bar compared them as text, so the order alone kept "Unsaved changes" up after every Save.
    const next = settings({ questions: [asSaved] } as unknown as Partial<BookingPageSettings>);
    const draft = settings({ questions: [asFiled] } as unknown as Partial<BookingPageSettings>);
    expect(changed(next, draft)).toEqual({});
    expect(changed(next, draftAfterSave(next, draft))).toEqual({});
  });

  it('still reads a real change to a question as unsaved', () => {
    const next = settings({ questions: [asSaved] } as unknown as Partial<BookingPageSettings>);
    const draft = settings({
      questions: [{ ...asFiled, label: 'Company name' }],
    } as unknown as Partial<BookingPageSettings>);
    expect(Object.keys(changed(next, draft))).toEqual(['questions']);
  });

  it('still reads moved questions as unsaved: the order of a list is a change', () => {
    const other = { ...asSaved, id: '0199f0a0-0000-7000-8000-000000000002', key: 'role', label: 'Role' };
    const next = settings({ questions: [asSaved, other] } as unknown as Partial<BookingPageSettings>);
    const draft = settings({ questions: [other, asSaved] } as unknown as Partial<BookingPageSettings>);
    expect(Object.keys(changed(next, draft))).toEqual(['questions']);
  });
});
