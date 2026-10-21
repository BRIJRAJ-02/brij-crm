// First run's steps and its address (spec 0036, AC-1204, AC-1209): which
// steps show, where Back goes, and what the search keeps.
import { describe, expect, it } from 'vitest';
import { isConnectResult, nextStep, previousStep, shownStep, welcomeSearch, welcomeSteps } from './steps.ts';

describe('first run’s steps', () => {
  it('are About you, Your workspace and Connect your calendar, without the calendar where sync is off', () => {
    expect(welcomeSteps(true)).toEqual(['about', 'workspace', 'calendar']);
    expect(welcomeSteps(false)).toEqual(['about', 'workspace']);
  });

  it('go back from Your workspace only: the first step has nothing before it, and the workspace is made by then', () => {
    expect(previousStep('about')).toBeUndefined();
    expect(previousStep('workspace')).toBe('about');
    expect(previousStep('calendar')).toBeUndefined();
  });

  it('go on in order, and end after the last', () => {
    expect(nextStep(welcomeSteps(true), 'about')).toBe('workspace');
    expect(nextStep(welcomeSteps(true), 'workspace')).toBe('calendar');
    expect(nextStep(welcomeSteps(false), 'workspace')).toBeUndefined();
  });

  it('show the calendar step once the workspace exists, and never before', () => {
    expect(shownStep(undefined, false)).toBe('about');
    expect(shownStep('workspace', false)).toBe('workspace');
    expect(shownStep('calendar', false)).toBe('about');
    expect(shownStep('about', true)).toBe('calendar');
  });
});

describe('first run’s search', () => {
  it('keeps a known step, an address and a connect result', () => {
    expect(welcomeSearch({ step: 'workspace' })).toEqual({ step: 'workspace' });
    expect(welcomeSearch({ step: 'calendar', workspace: 'acme', calendar: 'connected' })).toEqual({
      step: 'calendar',
      workspace: 'acme',
      calendar: 'connected',
    });
  });

  it('drops anything else: an unknown step, an address that breaks the rule, a result it doesn’t know', () => {
    expect(welcomeSearch({ step: 'invite', workspace: '../evil', calendar: 'pwned' })).toEqual({});
    expect(welcomeSearch({ step: 3, workspace: ['acme'], calendar: { connected: true } })).toEqual({});
  });

  it('knows exactly the results a calendar connect comes back with', () => {
    for (const result of ['connected', 'denied', 'scope', 'limit', 'off', 'failed']) {
      expect(isConnectResult(result)).toBe(true);
    }
    expect(isConnectResult('toString')).toBe(false);
  });
});
