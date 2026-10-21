import { describe, expect, it } from 'vitest';
import { decodeCsv, detectSeparator, isCsvName, parseCsv, readCsvFile, type CsvResult } from './csv.ts';

const table = (result: CsvResult) => {
  if (!result.ok) throw new Error(`Refused: ${result.reason}`);
  return result.table;
};

const LIMITS = { rows: 5, columns: 4, bytes: 1_000 };

describe('parseCsv (AC-1112)', () => {
  it('reads headers and rows, quoted separators, doubled quotes and line breaks', () => {
    const read = table(parseCsv('Name,Note\r\n"Lovelace, Ada","said ""hi""\nthen left"\r\nBob,plain\n', ','));
    expect(read.headers).toEqual(['Name', 'Note']);
    expect(read.rows).toEqual([
      ['Lovelace, Ada', 'said "hi"\nthen left'],
      ['Bob', 'plain'],
    ]);
  });

  it('names an empty header, pads short rows and drops empty ones', () => {
    const read = table(parseCsv('Name,,Email\nAda\n\n,,\nBob,x,b@example.com', ','));
    expect(read.headers).toEqual(['Name', 'Column 2', 'Email']);
    expect(read.rows).toEqual([
      ['Ada', '', ''],
      ['Bob', 'x', 'b@example.com'],
    ]);
  });

  it('reads CR line ends and a last line with no end', () => {
    expect(table(parseCsv('A;B\rx;y\r1;2', ';')).rows).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('refuses too many rows or columns, an unclosed quote and a file with no data', () => {
    expect(parseCsv('A\n1\n2\n3\n4\n5\n6', ',', LIMITS)).toMatchObject({ ok: false, reason: 'rows', limit: 5 });
    expect(parseCsv('A,B,C,D,E\n1', ',', LIMITS)).toMatchObject({ ok: false, reason: 'columns', columns: 5 });
    expect(parseCsv('A\n"open', ',')).toMatchObject({ ok: false, reason: 'quote' });
    expect(parseCsv('A,B\n', ',')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseCsv('', ',')).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('detectSeparator', () => {
  it('finds a comma, a semicolon or a tab, ignoring ones inside quotes', () => {
    expect(detectSeparator('a,b,c\n1,2,3')).toBe(',');
    expect(detectSeparator('a;b;c\n1;2,5;3\n4;5;6')).toBe(';');
    expect(detectSeparator('a\tb\n"x,y,z"\t2')).toBe('\t');
    expect(detectSeparator('one column\nonly')).toBe(',');
  });
});

describe('decodeCsv', () => {
  it('drops a UTF-8 byte order mark, and reads bytes that aren’t UTF-8 as Windows-1252', () => {
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xc3, 0xa9]))).toEqual({ text: 'Aé', encoding: 'utf-8' });
    expect(decodeCsv(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x80]))).toEqual({
      text: 'Café€',
      encoding: 'windows-1252',
    });
  });
});

describe('readCsvFile', () => {
  const file = (name: string, text: string) => {
    const bytes = new TextEncoder().encode(text);
    return { name, size: bytes.byteLength, arrayBuffer: () => Promise.resolve(bytes.buffer) };
  };
  it('takes .csv, .tsv and .txt only, and refuses a file over the size before reading it', async () => {
    expect(isCsvName('People.CSV')).toBe(true);
    expect(isCsvName('people.xlsx')).toBe(false);
    expect(await readCsvFile(file('a.xlsx', 'A\n1'))).toMatchObject({ ok: false, reason: 'type' });
    expect(await readCsvFile({ ...file('a.csv', 'A\n1'), size: 2_000 }, LIMITS)).toMatchObject({
      ok: false,
      reason: 'bytes',
      bytes: 2_000,
    });
    const read = await readCsvFile(file('a.tsv', 'Name\tEmail\nAda\tada@example.com'));
    expect(read.ok && read.table.separator).toBe('\t');
  });
});
