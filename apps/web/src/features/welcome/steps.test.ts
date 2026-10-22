// First run's steps and its address (spec 0036, AC-1204, AC-1209): which
// steps show, where Back goes, and what the search keeps.
import { describe, expect, it } from 'vitest';
import {
  isConnectResult,
  nextStep,
  previousStep,
  shownStep,
  welcomeLanding,
  welcomeSearch,
  welcomeSteps,
} from './steps.ts';

describe('first run’s steps', () => {
  it('are Your name, Your workspace, Invite your team and the calendar, without it where sync is off', () => {
    expect(welcomeSteps(true)).toEqual(['about', 'workspace', 'invite', 'calendar']);
    expect(welcomeSteps(false)).toEqual(['about', 'workspace', 'invite']);
    // Another workspace counts its own steps.
    expect(welcomeSteps(true, true)).toEqual(['workspace', 'invite', 'calendar']);
  });

  it('go back from Your workspace only: the first step has nothing before it, and the workspace is made by then', () => {
    expect(previousStep('about')).toBeUndefined();
    expect(previousStep('workspace')).toBe('about');
    expect(previousStep('invite')).toBeUndefined();
    expect(previousStep('calendar')).toBeUndefined();
  });

  it('go on in order, and end after the last', () => {
    expect(nextStep(welcomeSteps(true), 'about')).toBe('workspace');
    expect(nextStep(welcomeSteps(true), 'workspace')).toBe('invite');
    expect(nextStep(welcomeSteps(true), 'invite')).toBe('calendar');
    expect(nextStep(welcomeSteps(false), 'invite')).toBeUndefined();
  });

  it('show Invite your team and the calendar step once the workspace exists, and never before', () => {
    expect(shownStep(undefined, false)).toBe('about');
    expect(shownStep('workspace', false)).toBe('workspace');
    expect(shownStep('calendar', false)).toBe('about');
    expect(shownStep('invite', false)).toBe('about');
    expect(shownStep('about', true)).toBe('invite');
    expect(shownStep('invite', true)).toBe('invite');
    expect(shownStep('calendar', true)).toBe('calendar');
  });

  it('start another workspace at Your workspace (spec 0031)', () => {
    expect(shownStep(undefined, false, true)).toBe('workspace');
    expect(shownStep('about', true, true)).toBe('invite');
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
    expect(welcomeSearch({ step: 'nope', workspace: '../evil', calendar: 'pwned' })).toEqual({});
    expect(welcomeSearch({ step: 3, workspace: ['acme'], calendar: { connected: true } })).toEqual({});
  });

  it('drops the questionnaire step taken out on 22 October 2026, so an old link starts at Your name', () => {
    expect(welcomeSearch({ step: 'details' })).toEqual({});
    expect(shownStep(welcomeSearch({ step: 'details' }).step, false)).toBe('about');
  });

  it('knows exactly the results a calendar connect comes back with', () => {
    for (const result of ['connected', 'denied', 'scope', 'limit', 'off', 'failed']) {
      expect(isConnectResult(result)).toBe(true);
    }
    expect(isConnectResult('toString')).toBe(false);
  });
});

describe('where /welcome goes', () => {
  const acme = { id: 'w1', slug: 'acme', name: 'Acme' };
  const beta = { id: 'w2', slug: 'beta', name: 'Beta' };

  it('starts the steps for someone with no workspace, whatever the address asks', () => {
    expect(welcomeLanding([], undefined)).toEqual({ kind: 'steps', workspace: undefined });
    expect(welcomeLanding([], 'acme')).toEqual({ kind: 'steps', workspace: undefined });
  });

  it('keeps the steps after the workspace for one of their own', () => {
    expect(welcomeLanding([acme, beta], 'beta')).toEqual({ kind: 'steps', workspace: beta });
  });

  it('passes over a workspace that isn’t theirs, opening their own', () => {
    expect(welcomeLanding([acme], 'someone-elses')).toEqual({ kind: 'open', slug: 'acme' });
  });

  it('opens the first workspace for someone who has one and asks for none', () => {
    expect(welcomeLanding([acme, beta], undefined)).toEqual({ kind: 'open', slug: 'acme' });
  });

  it('opens the last used workspace it is given, and keeps the steps open for another (spec 0031)', () => {
    expect(welcomeLanding([acme, beta], undefined, beta)).toEqual({ kind: 'open', slug: 'beta' });
    expect(welcomeLanding([acme, beta], undefined, beta, true)).toEqual({ kind: 'steps', workspace: undefined });
    expect(welcomeLanding([acme, beta], 'beta', acme, true)).toEqual({ kind: 'steps', workspace: beta });
  });
});
