// Writing Excel workbooks (lane wip/crm-dataio, scope #30): a records export
// in the `xlsx` format writes its rows as SpreadsheetML `<row>` fragments in
// the same chunks a CSV writes its lines in (`exportStep`), and the download
// wraps them, as they stream, into a one sheet workbook with fflate's zip.
// Text is an inline string, which a spreadsheet never runs as a formula, so
// no formula guard is needed and the text reads back exactly; numbers and
// ratings are number cells, a checkbox a boolean, the header bold. Characters
// XML can't hold (control characters but tab and line ends) are dropped.
// Pure apart from the stream; no I/O.
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';

/** How a cell is written: text, a number, or true or false. */
export type XlsxCellKind = 'text' | 'number' | 'boolean';

/** The cell kind an attribute type's export text is written as. */
export function xlsxKind(type: string): XlsxCellKind {
  if (type === 'number' || type === 'rating') return 'number';
  if (type === 'checkbox') return 'boolean';
  return 'text';
}

/** Text as XML holds it: `&`, `<` and `>` escaped, characters XML refuses dropped. */
export function xmlEscape(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- XML 1.0 refuses these control characters outright.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/gu, '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  );
}

/** One cell: empty for no text; a number cell only for a finite number, else text. */
export function xlsxCell(text: string, kind: XlsxCellKind, style?: number): string {
  const styled = style === undefined ? '' : ` s="${String(style)}"`;
  if (text === '') return `<c${styled}/>`;
  if (kind === 'number' && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/u.test(text.trim()) && Number.isFinite(Number(text))) {
    return `<c${styled}><v>${text.trim()}</v></c>`;
  }
  if (kind === 'boolean' && (text === 'TRUE' || text === 'FALSE')) {
    return `<c${styled} t="b"><v>${text === 'TRUE' ? '1' : '0'}</v></c>`;
  }
  return `<c${styled} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

/** One row of cells already written by `xlsxCell`. */
export function xlsxRow(cells: readonly string[]): string {
  return `<row>${cells.join('')}</row>`;
}

/** The header row: every title a bold text cell (style 1). */
export function xlsxHeader(titles: readonly string[]): string {
  return xlsxRow(titles.map((title) => xlsxCell(title, 'text', 1)));
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006';

/** A sheet's tab name as Excel takes it: no `[]:*?/\`, at most 31 characters, never empty. */
export function sheetName(name: string): string {
  return (
    name
      .replace(/[[\]:*?/\\]/gu, ' ')
      .trim()
      .slice(0, 31) || 'Sheet1'
  );
}

/** The workbook's fixed parts around one sheet, by path. */
function fixedParts(name: string): readonly (readonly [string, string])[] {
  return [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${PACKAGE}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE}/relationships"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${RELS}"><sheets><sheet name="${xmlEscape(sheetName(name)).replaceAll('"', '&quot;')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE}/relationships"><Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${RELS}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    ],
  ];
}

/** The sheet part's head (a frozen header row) and foot, around the rows. */
const SHEET_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>`;
const SHEET_FOOT = '</sheetData></worksheet>';

/**
 * A workbook as a stream: the fixed parts, then one sheet named `name` whose
 * rows are the chunks `next` hands over in order (undefined when there are no
 * more), deflated as they come, so the file is never held whole.
 */
export function xlsxStream(name: string, next: () => Promise<string | undefined>): ReadableStream<Uint8Array> {
  let zip: Zip | undefined;
  let sheet: ZipDeflate | undefined;
  let ended = false;
  const out: Uint8Array[] = [];
  let failed: Error | undefined;
  const start = () => {
    zip = new Zip((error, chunk) => {
      if (error !== null) failed = error;
      else out.push(chunk);
    });
    for (const [path, text] of fixedParts(name)) {
      const part = new ZipPassThrough(path);
      zip.add(part);
      part.push(strToU8(text), true);
    }
    sheet = new ZipDeflate('xl/worksheets/sheet1.xml', { level: 6 });
    zip.add(sheet);
    sheet.push(strToU8(SHEET_HEAD));
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (zip === undefined) start();
      // Pull rows until the zip has something to hand on, or the rows run out.
      while (out.length === 0 && !ended) {
        const text = await next();
        if (text === undefined) {
          sheet?.push(strToU8(SHEET_FOOT), true);
          zip?.end();
          ended = true;
        } else if (text !== '') sheet?.push(strToU8(text));
      }
      if (failed !== undefined) {
        controller.error(failed);
        return;
      }
      for (const chunk of out.splice(0)) controller.enqueue(chunk);
      if (ended) controller.close();
    },
  });
}
