import { describe, expect, it } from 'vitest';
import { checkAnswers } from './check.ts';
import { matchesContent, sanitiseFileName, storedNameOf, uploadTypeOf } from './uploads.ts';

const pdf = uploadTypeOf('application/pdf');
const png = uploadTypeOf('image/png; charset=binary');

describe('upload types', () => {
  it('takes only the allowlist, never svg or html', () => {
    expect(pdf?.contentType).toBe('application/pdf');
    expect(png?.contentType).toBe('image/png');
    expect(uploadTypeOf('image/svg+xml')).toBeUndefined();
    expect(uploadTypeOf('text/html')).toBeUndefined();
  });

  it('checks the first bytes against the type', () => {
    if (pdf === undefined || png === undefined) throw new Error('types missing');
    expect(matchesContent(pdf, new TextEncoder().encode('%PDF-1.7\n'))).toBe(true);
    expect(matchesContent(pdf, new TextEncoder().encode('<script>alert(1)</script>'))).toBe(false);
    expect(matchesContent(png, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(matchesContent(png, new TextEncoder().encode('%PDF-1.7'))).toBe(false);
  });
});

describe('sanitiseFileName', () => {
  it('drops paths, control and direction characters, and leading dots', () => {
    if (pdf === undefined) throw new Error('type missing');
    expect(sanitiseFileName('..\\..\\etc/passwd.pdf', pdf)).toBe('passwd.pdf');
    expect(sanitiseFileName('cv‮fdp.exe', pdf)).toBe('cvfdp.pdf');
    expect(sanitiseFileName('.hidden.pdf', pdf)).toBe('hidden.pdf');
    expect(sanitiseFileName('', pdf)).toBe('file.pdf');
  });

  it('keeps the extension when the name is long, and gives a wrong one the type’s own', () => {
    if (pdf === undefined) throw new Error('type missing');
    const long = sanitiseFileName(`${'a'.repeat(300)}.pdf`, pdf);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('.pdf')).toBe(true);
    expect(sanitiseFileName('photo.png', pdf)).toBe('photo.pdf');
  });

  it('stores under the id, never the visitor’s name', () => {
    if (pdf === undefined) throw new Error('type missing');
    expect(storedNameOf('abc', pdf)).toBe('abc.pdf');
  });
});

describe('a file answer', () => {
  const form = {
    language: 'en' as const,
    questions: [{ key: 'cv', answerType: 'file' as const, required: true }],
  };
  it('is the id of an upload, and counts as an answer', () => {
    const id = '0b9d6b3e-6b1e-4f43-8d1a-0c1c6a2b9a11';
    expect(checkAnswers(form, { cv: { fileId: id } })).toEqual({ ok: true, answers: { cv: { fileId: id } } });
    expect(checkAnswers(form, {}).ok).toBe(false);
    expect(checkAnswers(form, { cv: { fileId: 'not-an-id' } }).ok).toBe(false);
  });
});
