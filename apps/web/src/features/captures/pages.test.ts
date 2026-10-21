import { describe, expect, it } from 'vitest';
import { capturePageHref, formsHref, linksHref } from './pages.ts';

describe('the Scheduling list pages that took over Captures', () => {
  it('have addresses of their own (spec 0034, AC-928)', () => {
    expect(linksHref('acme')).toBe('/w/acme/booking-pages');
    expect(formsHref('acme')).toBe('/w/acme/forms');
  });

  it('name each page’s address by its key', () => {
    expect(capturePageHref('acme', 'links')).toBe(linksHref('acme'));
    expect(capturePageHref('acme', 'forms')).toBe(formsHref('acme'));
  });
});
