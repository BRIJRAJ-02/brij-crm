import { describe, expect, it } from 'vitest';
import { claimHandlePath } from './claim.ts';

describe('claimHandlePath', () => {
  it('names the app when the page is on the public booking origin, which serves no sign in page', () => {
    expect(claimHandlePath('ada', { page: 'https://timefix.com', booking: 'https://timefix.com' })).toBe(
      'https://app.timefix.com/sign-in?handle=ada',
    );
  });

  it('names a configured app instead, so a staging booking host never sends claimers to production', () => {
    expect(
      claimHandlePath('ada', {
        page: 'https://staging.timefix.com',
        booking: 'https://staging.timefix.com',
        app: 'https://app-staging.timefix.com',
      }),
    ).toBe('https://app-staging.timefix.com/sign-in?handle=ada');
  });

  it('falls back to this origin when the app origin is not an https origin', () => {
    expect(
      claimHandlePath('ada', { page: 'https://timefix.com', booking: 'https://timefix.com', app: 'nonsense' }),
    ).toBe('/sign-in?handle=ada');
  });

  it('stays on this origin where one host serves the app and the public pages (a preview, a laptop)', () => {
    expect(claimHandlePath('ada', { page: 'http://localhost:5970', booking: undefined })).toBe('/sign-in?handle=ada');
    expect(claimHandlePath('ada', { page: 'http://localhost:5970', booking: '' })).toBe('/sign-in?handle=ada');
  });

  it('stays on this origin when the page is on the app, not the public booking origin', () => {
    expect(claimHandlePath('ada', { page: 'https://app.timefix.com', booking: 'https://timefix.com' })).toBe(
      '/sign-in?handle=ada',
    );
  });

  it('reads a malformed setting as unset rather than breaking the link', () => {
    expect(claimHandlePath('ada', { page: 'https://timefix.com', booking: 'not an origin' })).toBe(
      '/sign-in?handle=ada',
    );
  });

  it('escapes a handle into the query', () => {
    expect(claimHandlePath('ada-lovelace-1843', { page: 'https://timefix.com', booking: 'https://timefix.com' })).toBe(
      'https://app.timefix.com/sign-in?handle=ada-lovelace-1843',
    );
  });
});
