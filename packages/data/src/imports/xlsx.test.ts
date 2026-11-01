import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { columnOf, isDateFormat, numberText, readXlsx, serialText, xmlText, XLSX_LIMITS } from './xlsx.ts';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A workbook's bytes from its sheets' `<sheetData>` bodies, with optional shared strings, styles and 1904 dates. */
function workbook(
  sheets: readonly { readonly name: string; readonly data: string; readonly state?: string }[],
  options: { readonly strings?: readonly string[]; readonly styles?: string; readonly date1904?: boolean } = {},
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${REL}">${
        options.date1904 === true ? '<workbookPr date1904="1"/>' : ''
      }<sheets>${sheets
        .map(
          (sheet, index) =>
            `<sheet name="${sheet.name}" sheetId="${String(index + 1)}" r:id="rId${String(index + 1)}"${
              sheet.state === undefined ? '' : ` state="${sheet.state}"`
            }/>`,
        )
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, index) =>
            `<Relationship Id="rId${String(index + 1)}" Type="${REL}/worksheet" Target="worksheets/sheet${String(index + 1)}.xml"/>`,
        )
        .join('')}</Relationships>`,
    ),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${String(index + 1)}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>${sheet.data}</sheetData></worksheet>`,
    );
  });
  if (options.strings !== undefined) {
    files['xl/sharedStrings.xml'] = strToU8(
      `<sst xmlns="${NS}">${options.strings.map((text) => `<si><t>${text}</t></si>`).join('')}</sst>`,
    );
  }
  if (options.styles !== undefined) files['xl/styles.xml'] = strToU8(options.styles);
  return zipSync(files);
}

const row = (cells: string) => `<row>${cells}</row>`;
const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

describe('readXlsx', () => {
  it('reads shared and inline strings, numbers and booleans as the CSV reader would', () => {
    const bytes = workbook(
      [
        {
          name: 'People',
          data:
            row(`<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c>`) +
            row(`${inline('A2', 'Ada &amp; Co')}<c r="B2"><v>0.30000000000000004</v></c><c r="C2" t="b"><v>1</v></c>`) +
            row(`${inline('A3', 'Grace')}<c r="C3" t="b"><v>0</v></c>`),
        },
      ],
      { strings: ['Name', 'Score', 'Active'] },
    );
    const read = readXlsx(bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.table.headers).toEqual(['Name', 'Score', 'Active']);
    expect(read.table.rows).toEqual([
      ['Ada & Co', '0.3', 'TRUE'],
      ['Grace', '', 'FALSE'],
    ]);
    expect(read.sheets).toEqual([{ name: 'People' }]);
  });

  it('takes the cached value of a formula and never its formula; text starting with = stays text', () => {
    const bytes = workbook([
      {
        name: 'Sheet1',
        data:
          row(`${inline('A1', 'Total')}${inline('B1', 'Note')}`) +
          row(`<c r="A2"><f>SUM(1,2)</f><v>3</v></c>${inline('B2', '=HYPERLINK("x")')}`) +
          row(`<c r="A3"><f>NOW()</f></c>${inline('B3', 'kept')}`),
      },
    ]);
    const read = readXlsx(bytes);
    expect(read.ok && read.table.rows).toEqual([
      ['3', '=HYPERLINK("x")'],
      ['', 'kept'],
    ]);
  });

  it('reads dates in a date style, in both date systems', () => {
    const styles = `<styleSheet xmlns="${NS}"><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`;
    const data =
      row(`${inline('A1', 'Day')}${inline('B1', 'At')}`) +
      row(`<c r="A2" s="1"><v>45658</v></c><c r="B2" s="2"><v>45658.5</v></c>`);
    const read = readXlsx(workbook([{ name: 'S', data }], { styles }));
    expect(read.ok && read.table.rows).toEqual([['2025-01-01', '2025-01-01 12:00']]);
    const in1904 = readXlsx(workbook([{ name: 'S', data }], { styles, date1904: true }));
    expect(in1904.ok && in1904.table.rows).toEqual([['2029-01-02', '2029-01-02 12:00']]);
  });

  it('places cells by their reference, leaving gaps empty', () => {
    const bytes = workbook([
      { name: 'S', data: row(`${inline('A1', 'a')}${inline('C1', 'c')}`) + row(inline('C2', 'z')) },
    ]);
    const read = readXlsx(bytes);
    expect(read.ok && read.table).toEqual({ headers: ['a', 'Column 2', 'c'], rows: [['', '', 'z']] });
  });

  it('lists visible sheets, reads the first with data, and reads the one asked for', () => {
    const bytes = workbook([
      { name: 'Cover', data: row(inline('A1', 'Only a title')) },
      { name: 'Secret', data: row(inline('A1', 'x')) + row(inline('A2', 'y')), state: 'hidden' },
      { name: 'Deals', data: row(inline('A1', 'Deal')) + row(inline('A2', 'Big one')) },
      { name: 'Notes', data: row(inline('A1', 'Note')) + row(inline('A2', 'Hi')) },
    ]);
    const first = readXlsx(bytes);
    expect(first.sheets.map((sheet) => sheet.name)).toEqual(['Cover', 'Deals', 'Notes']);
    expect(first.sheet).toBe(1);
    expect(first.ok && first.table.rows).toEqual([['Big one']]);
    const asked = readXlsx(bytes, 2);
    expect(asked.sheet).toBe(2);
    expect(asked.ok && asked.table.rows).toEqual([['Hi']]);
    expect(readXlsx(bytes, 0)).toMatchObject({ ok: false, reason: 'empty', sheet: 0 });
  });

  it('refuses past the row and column limits', () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      row(inline(`A${String(index + 1)}`, `r${String(index)}`)),
    ).join('');
    expect(readXlsx(workbook([{ name: 'S', data: rows }]), undefined, { ...XLSX_LIMITS, rows: 3 })).toMatchObject({
      ok: false,
      reason: 'rows',
    });
    const wide = row(`${inline('A1', 'a')}${inline('E1', 'e')}`) + row(inline('A2', 'b'));
    expect(readXlsx(workbook([{ name: 'S', data: wide }]), undefined, { ...XLSX_LIMITS, columns: 3 })).toMatchObject({
      ok: false,
      reason: 'columns',
      columns: 5,
    });
  });

  it('stops a zip bomb at the inflate cap, whatever sizes it claims', () => {
    const big = `<c r="A1" t="inlineStr"><is><t>${'x'.repeat(2_000_000)}</t></is></c>`;
    const bytes = workbook([{ name: 'S', data: row(big) + row(inline('A2', 'y')) }]);
    expect(bytes.length).toBeLessThan(50_000);
    expect(readXlsx(bytes, undefined, { ...XLSX_LIMITS, partBytes: 1_000_000, totalBytes: 1_500_000 })).toMatchObject({
      ok: false,
      reason: 'bytes',
    });
  });

  it('refuses a file that is not a workbook', () => {
    expect(readXlsx(strToU8('name,email\nAda,ada@example.com'))).toMatchObject({ ok: false, reason: 'broken' });
    expect(readXlsx(zipSync({ 'hello.txt': strToU8('hi') }))).toMatchObject({ ok: false, reason: 'broken' });
  });
});

describe('the pieces', () => {
  it('decodes XML text without expanding anything but the named and numeric entities', () => {
    expect(xmlText('a &lt;b&gt; &amp;amp; &#65;&#x42; _x000D_ &unknown;')).toBe('a <b> &amp; AB \r &unknown;');
  });

  it('tells date formats from number formats', () => {
    expect(isDateFormat('yyyy-mm-dd')).toBe(true);
    expect(isDateFormat('[$-409]d-mmm-yy;@')).toBe(true);
    expect(isDateFormat('h:mm AM/PM')).toBe(true);
    expect(isDateFormat('#,##0.00')).toBe(false);
    expect(isDateFormat('0.00E+00')).toBe(false);
    expect(isDateFormat('[Red]#,##0 "days"')).toBe(false);
    expect(isDateFormat('General')).toBe(false);
  });

  it('writes serials, numbers and column letters', () => {
    expect(serialText(1, 'date', false)).toBe('1899-12-31');
    expect(serialText(0.75, 'time', false)).toBe('18:00');
    expect(numberText('1.5E-3')).toBe('0.0015');
    expect(numberText('4155551234')).toBe('4155551234');
    expect(columnOf('A1')).toBe(0);
    expect(columnOf('AA10')).toBe(26);
    expect(columnOf(undefined)).toBeUndefined();
  });
});
