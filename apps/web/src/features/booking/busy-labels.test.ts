// Busy labels say what is happening in plain words, with no trailing "…" (the house copy rule, 22 October 2026).
import { describe, expect, it } from 'vitest';
import { strings as memberStrings } from '../settings/members-strings.ts';
import { strings as securityStrings } from '../settings/security-strings.ts';
import { strings as workspaceSecurityStrings } from '../settings/workspace-security-strings.ts';
import { strings as workspaceStrings } from '../settings/workspace-strings.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

describe('busy labels', () => {
  it('read as plain words, never ending in an ellipsis', () => {
    const labels = [
      strings.destinationLoading,
      memberStrings.domainSaving('acme.com'),
      scheduleStrings.creatingSchedule,
      scheduleStrings.deleting,
      scheduleStrings.copying,
      scheduleStrings.renaming,
      scheduleStrings.saving,
      securityStrings.signingOut,
      securityStrings.twoFactor.turningOn,
      securityStrings.twoFactor.turningOff,
      securityStrings.twoFactor.making,
      securityStrings.deletion.checking,
      workspaceSecurityStrings.signingOut,
      workspaceStrings.addressChecking,
    ];
    for (const label of labels) {
      expect(label).not.toMatch(/(…|\.\.\.)$/u);
    }
    expect(strings.destinationLoading).toBe('Loading calendars');
    expect(memberStrings.domainSaving('acme.com')).toBe('Turning on for @acme.com');
  });
});
