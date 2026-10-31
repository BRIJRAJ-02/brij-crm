import { describe, expect, it } from 'vitest';
import { hasExecutableName, opensInline } from './file-limits.ts';

describe('record file names', () => {
  it('refuses an executable extension anywhere in the name', () => {
    expect(hasExecutableName('setup.exe')).toBe(true);
    expect(hasExecutableName('invoice.exe.pdf')).toBe(true);
    expect(hasExecutableName('Notes.HTML.txt')).toBe(true);
    expect(hasExecutableName('logo.svg')).toBe(true);
    expect(hasExecutableName('run. sh .txt')).toBe(true);
    // As the server checks it: after Unicode normalising, so a full width `.ｅｘｅ` is caught too.
    expect(hasExecutableName('invoice.ｅｘｅ.pdf'.normalize('NFKC'))).toBe(true);
  });

  it('takes ordinary names', () => {
    expect(hasExecutableName('Proposal v2.pdf')).toBe(false);
    expect(hasExecutableName('photo.jpeg')).toBe(false);
    expect(hasExecutableName('README')).toBe(false);
    expect(hasExecutableName('sheet.xlsx')).toBe(false);
  });
});

describe('inline files', () => {
  it('opens raster images in the browser and nothing else', () => {
    expect(opensInline('image/png')).toBe(true);
    expect(opensInline('image/webp')).toBe(true);
    expect(opensInline('image/svg+xml')).toBe(false);
    expect(opensInline('application/pdf')).toBe(false);
    expect(opensInline('text/plain')).toBe(false);
  });
});
