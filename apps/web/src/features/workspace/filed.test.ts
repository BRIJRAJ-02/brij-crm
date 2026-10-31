// The filed notice's words (spec 0059, AC-5920): what a write's filing says,
// with Undo, and what the Undo then says it did.
import { describe, expect, it, vi } from 'vitest';
import type { FiledNotice, UnfileOutcome } from '@crm/data';
import { filedStrings, filedToast, unfiledToast } from './filed.ts';

const notice = (companies: FiledNotice['companies']): FiledNotice => ({
  workspace: 'acme',
  companies,
  undo: () => Promise.resolve({ kind: 'gone' }),
});

const unfiled = (outcome: Partial<Extract<UnfileOutcome, { kind: 'unfiled' }>>): UnfileOutcome => ({
  kind: 'unfiled',
  name: 'Acme',
  unlinked: 1,
  kept: 0,
  trashed: 0,
  inUse: 0,
  failed: 0,
  ...outcome,
});

describe('filedToast', () => {
  it('names the company linked, or the company added, with Undo', () => {
    const onUndo = vi.fn();
    const linked = filedToast(notice([{ name: 'Acme', made: false }]), onUndo);
    expect(linked).toMatchObject({ tone: 'success', message: 'Linked to Acme.', action: { label: 'Unlink' } });
    linked.action?.onAction();
    expect(onUndo).toHaveBeenCalledOnce();
    expect(filedToast(notice([{ name: 'Acme', made: true }]), onUndo).message).toBe('Added Acme and linked it.');
  });

  it('never names a company the writer can’t read, and counts a paste’s people', () => {
    const onUndo = vi.fn();
    expect(filedToast(notice([{ name: '', made: true }]), onUndo).message).toBe('Added their company and linked it.');
    expect(filedToast(notice([{ name: '', made: false }]), onUndo).message).toBe('Linked to their company.');
    const many = notice([
      { name: 'Acme', made: false },
      { name: 'Globex', made: true },
    ]);
    expect(filedToast(many, onUndo).message).toBe('Linked 2 people to companies, 1 of them new.');
  });
});

describe('unfiledToast', () => {
  it('says what the Undo took back', () => {
    expect(unfiledToast(unfiled({}))).toEqual({ tone: 'success', message: 'Removed the link to Acme.' });
    expect(unfiledToast(unfiled({ trashed: 1 }))).toEqual({
      tone: 'success',
      message: 'Deleted Acme and removed the link.',
    });
    expect(unfiledToast(unfiled({ unlinked: 3 }))?.message).toBe('Removed 3 company links.');
    expect(unfiledToast(unfiled({ unlinked: 3, trashed: 2 }))?.message).toBe(
      'Removed 3 company links and deleted 2 companies it added.',
    );
  });

  it('says what it kept, and why', () => {
    expect(unfiledToast(unfiled({ inUse: 1 }))?.message).toBe(`Removed the link to Acme. ${filedStrings.inUse(1)}`);
    expect(unfiledToast(unfiled({ unlinked: 0, kept: 1 }))).toEqual({
      tone: 'success',
      message: 'Company was changed since, so it was kept.',
    });
    expect(unfiledToast({ kind: 'gone' })).toEqual({ tone: 'success', message: 'Already undone.' });
    expect(unfiledToast(unfiled({ trashed: 0, failed: 1 }))).toEqual({
      tone: 'danger',
      message: `Removed the link to Acme. ${filedStrings.notDeleted(1)}`,
    });
  });

  it('says nothing when every link was refused for another reason (that raised its own toast)', () => {
    expect(unfiledToast(unfiled({ unlinked: 0 }))).toBeUndefined();
  });
});
