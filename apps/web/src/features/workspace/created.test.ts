// The toast once New record made a record: its name, and Open to its page.
import type { RecordView } from '@crm/data';
import { describe, expect, it, vi } from 'vitest';
import { createdToast } from './created.ts';

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
