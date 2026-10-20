// CSV writing: quoting (RFC 4180), CRLF, and the formula guard against CSV injection.
import { describe, expect, it } from 'vitest';
import { csvCell, csvLine } from './csv.ts';

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks, and leaves plain text alone', () => {
    expect(csvCell('Ada')).toBe('Ada');
    expect(csvCell('Lovelace, Ada')).toBe('"Lovelace, Ada"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(true)).toBe('true');
  });

  it('guards every formula start in text with an apostrophe', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvCell(`${start}SUM(A1)`).replace(/^"/u, '').startsWith(`'${start}`)).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });
});

describe('csvLine', () => {
  it('joins cells with commas and ends with CRLF', () => {
    expect(csvLine(['a', 1, undefined, 'b,c'])).toBe('a,1,,"b,c"\r\n');
  });
});
