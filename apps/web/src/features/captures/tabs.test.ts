import { describe, expect, it } from 'vitest';
import { captureTabHref, captureTabOf, formsHref, isCaptureTab, linksHref } from './tabs.ts';

describe('the Captures tabs', () => {
  it('names each tab by its address, and Links for anything else under Captures', () => {
    expect(captureTabOf('/w/acme/captures/links')).toBe('links');
    expect(captureTabOf('/w/acme/captures/forms')).toBe('forms');
    expect(captureTabOf('/w/acme/captures/forms/')).toBe('forms');
    expect(captureTabOf('/w/acme/captures')).toBe('links');
  });

  it('builds each tab’s address', () => {
    expect(linksHref('acme')).toBe('/w/acme/captures/links');
    expect(formsHref('acme')).toBe('/w/acme/captures/forms');
    expect(captureTabHref('acme', 'forms')).toBe(formsHref('acme'));
  });

  it('knows only its two tabs', () => {
    expect(isCaptureTab('links')).toBe(true);
    expect(isCaptureTab('forms')).toBe(true);
    expect(isCaptureTab('booking-pages')).toBe(false);
  });
});
