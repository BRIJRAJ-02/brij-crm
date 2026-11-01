// The workbook writer (lane wip/crm-dataio): cells by kind, escaping, and the streamed zip a spreadsheet opens.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { sheetName, xlsxCell, xlsxHeader, xlsxKind, xlsxRow, xlsxStream, xmlEscape } from './xlsx.ts';

/** A stream's bytes, whole. */
async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('xlsx cells', () => {
  it('writes text inline (never a formula), numbers and booleans by kind, and empties as empty cells', () => {
    expect(xlsxCell('=SUM(A1)', 'text')).toBe('<c t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t></is></c>');
    expect(xlsxCell('12.5', 'number')).toBe('<c><v>12.5</v></c>');
    expect(xlsxCell('12 apples', 'number')).toContain('inlineStr');
    expect(xlsxCell('TRUE', 'boolean')).toBe('<c t="b"><v>1</v></c>');
    expect(xlsxCell('', 'text')).toBe('<c/>');
    expect(xlsxHeader(['Name'])).toBe(
      '<row><c s="1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c></row>',
    );
    expect(xlsxRow(['<c/>', '<c/>'])).toBe('<row><c/><c/></row>');
  });

  it('escapes markup and drops what XML cannot hold', () => {
    expect(xmlEscape('a < b & c > d\u0001\u0007\tok')).toBe('a &lt; b &amp; c &gt; d\tok');
  });

  it('picks the cell kind from the attribute type, and a sheet name Excel takes', () => {
    expect(xlsxKind('number')).toBe('number');
    expect(xlsxKind('rating')).toBe('number');
    expect(xlsxKind('checkbox')).toBe('boolean');
    expect(xlsxKind('currency')).toBe('text');
    expect(sheetName('People: [all]/today')).toBe('People   all  today');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(sheetName('???')).toBe('Sheet1');
  });
});

describe('xlsxStream', () => {
  it('streams a workbook whose one sheet holds the chunks in order', async () => {
    const chunks = [xlsxHeader(['Name', 'Score']), xlsxRow([xlsxCell('Ada', 'text'), xlsxCell('3', 'number')]), ''];
    let at = 0;
    const zip = await bytesOf(xlsxStream('People', () => Promise.resolve(chunks[at++])));
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'] ?? new Uint8Array());
    expect(sheet).toContain('<sheetData><row><c s="1" t="inlineStr">');
    expect(sheet).toContain('<c><v>3</v></c></row></sheetData></worksheet>');
    expect(strFromU8(files['xl/workbook.xml'] ?? new Uint8Array())).toContain('<sheet name="People"');
  });

  it('fails the stream when a chunk read fails', async () => {
    const failing = xlsxStream('S', () => Promise.reject(new Error('gone')));
    await expect(bytesOf(failing)).rejects.toThrow('gone');
  });
});
