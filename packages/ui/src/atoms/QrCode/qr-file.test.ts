// The saved code's file name (spec 0073, batch 2): from what the code is for, safe on every file system.
import { describe, expect, it } from 'vitest';
import { qrFileName } from './qr-file.ts';

describe('qrFileName', () => {
  it('names the file after the thing, in lower case words joined by hyphens', () => {
    expect(qrFileName('Discovery call')).toBe('discovery-call-qr');
    expect(qrFileName('  Lead qualification (v2)! ')).toBe('lead-qualification-v2-qr');
  });

  it('keeps nothing a file system or a path could read as more than a name', () => {
    expect(qrFileName('../../etc/passwd')).toBe('etc-passwd-qr');
    expect(qrFileName('a/b\\c:d')).toBe('a-b-c-d-qr');
  });

  it('falls back to "link" when nothing is left', () => {
    expect(qrFileName('')).toBe('link-qr');
    expect(qrFileName('✨✨')).toBe('link-qr');
  });
});
