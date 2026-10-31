// The toast once New record made a record: its name, and Open to its page.
import type { FiledNotice, RecordView } from '@crm/data';
import { describe, expect, it, vi } from 'vitest';
import { CREATED_TOAST_MS, createdToast, createdToastFor } from './created.ts';
import { FILED_TOAST_MS } from './filed.ts';

const record = (name: string) => ({ id: 'r1', values: {}, display: { name } }) as unknown as RecordView;

describe('createdToast', () => {
  it('names the record, with Open', () => {
    const onOpen = vi.fn();
    const toast = createdToast(record('Ada Lovelace'), 'Person', onOpen);
    expect(toast).toMatchObject({ tone: 'success', message: 'Ada Lovelace created', action: { label: 'Open' } });
    toast.action?.onAction();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('says Unnamed for a record with no name', () => {
    expect(createdToast(record(' '), 'Person', () => undefined).message).toBe('Unnamed person created');
  });
});

describe('createdToastFor', () => {
  const notice: FiledNotice = {
    workspace: 'acme',
    companies: [{ name: 'Acme', made: false }],
    undo: () => Promise.resolve({ kind: 'gone' }),
  };

  it('is the created toast with Open when nothing was filed', () => {
    const { content, timeout } = createdToastFor(record('Jane'), 'Person', () => undefined, undefined);
    expect(content).toMatchObject({ message: 'Jane created', action: { label: 'Open' } });
    expect(timeout).toBe(CREATED_TOAST_MS);
  });

  it('says the create and the link in one toast, with Unlink, when her email filed her (spec 0059)', () => {
    const onUnlink = vi.fn();
    const { content, timeout } = createdToastFor(record('Jane'), 'Person', () => undefined, { notice, onUnlink });
    expect(content).toMatchObject({ message: 'Jane created and linked to Acme', action: { label: 'Unlink' } });
    expect(timeout).toBe(FILED_TOAST_MS);
    content.action?.onAction();
    expect(onUnlink).toHaveBeenCalledOnce();
    expect(createdToastFor(record(''), 'Person', () => undefined, { notice, onUnlink }).content.message).toBe(
      'Unnamed person created and linked to Acme',
    );
  });
});
