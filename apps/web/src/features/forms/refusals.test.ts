import { dataError } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { saveFailureMessage } from './refusals.ts';
import { strings } from './strings.ts';

describe('a failed draft save', () => {
  it('asks to check the connection only when the server was never reached', () => {
    expect(saveFailureMessage(dataError('API_UNAVAILABLE', 'Can’t reach Timefix.'))).toBe(strings.saveFailed);
  });

  it('says what the server refused, never "check your connection"', () => {
    const refused = dataError('INPUT_INVALID', 'Input is invalid.', {
      issues: [{ path: ['document', 'after', 'url'], message: 'Give a full address that starts with https://.' }],
    });
    const message = saveFailureMessage(refused);
    expect(message).toBe(strings.saveRefused('Give a full address that starts with https://.'));
    expect(message).not.toContain('connection');
  });
});
