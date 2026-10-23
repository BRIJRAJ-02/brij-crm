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
