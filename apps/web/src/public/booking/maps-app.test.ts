import { describe, expect, it } from 'vitest';
import { mapsAppFor } from './maps-app.ts';

describe('mapsAppFor', () => {
  it('opens Apple Maps on an Apple device and Google Maps elsewhere', () => {
    expect(mapsAppFor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('apple');
    expect(mapsAppFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe('apple');
    expect(mapsAppFor('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0')).toBe('google');
    expect(mapsAppFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0')).toBe('google');
  });
});
