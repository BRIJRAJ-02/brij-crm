// Menu QR's files (spec 0065, H2): a table's address, the names its downloads are saved under, and every table's code
// in one zip. The codes are drawn by the library's QrCode on the page and saved through the link page's `qr-png.ts`,
// at 512 pixels (the checklabs rule). Nothing is sent anywhere: the zip is made in the browser.
import { menuTablePagePath } from '@crm/contracts/menu';
import { writeZip, type ZipEntry } from '@crm/contracts/zip';
import { publicBookingOrigin } from '../booking/links.ts';
import { qrPng, qrSvg } from '../link-page/qr-png.ts';

/** How many pixels a side a downloaded code is. */
export const QR_FILE_SIZE = 512;

/** The address a table's code opens: the place's guest menu with the table's code. */
export const tableMenuAddress = (menuKey: string, code: string): string =>
  `${publicBookingOrigin()}${menuTablePagePath(menuKey, code)}`;

/** A file name from a place and a table ("somewhere-t4.png"): lowercase letters, digits and dashes only. */
export function codeFileName(place: string, label: string, extension: 'png' | 'svg' | 'zip'): string {
  const words = `${place} ${label}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${words === '' ? 'table' : words}-qr.${extension}`;
}

/** One drawn code to save: its table's label and the SVG the page drew. */
export interface DrawnCode {
  readonly label: string;
  readonly svg: SVGSVGElement;
}

/** One code as a file, PNG or SVG, at 512 pixels. */
export function codeFile(svg: SVGSVGElement, format: 'png' | 'svg'): Promise<Blob> {
  return format === 'png' ? qrPng(svg, QR_FILE_SIZE) : qrSvg(svg, QR_FILE_SIZE);
}

/** Every code as one zip of PNG or SVG files, one a table, named by the table, in order. */
export async function zipCodes(place: string, codes: readonly DrawnCode[], format: 'png' | 'svg'): Promise<Blob> {
  const entries: ZipEntry[] = [];
  const taken = new Set<string>();
  for (const code of codes) {
    const file = await codeFile(code.svg, format);
    let name = codeFileName(place, code.label, format);
    // Two labels that read the same once cleaned ("T 1" and "T1") still get a file each.
    for (let again = 2; taken.has(name); again += 1)
      name = codeFileName(place, `${code.label} ${String(again)}`, format);
    taken.add(name);
    entries.push({ name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return new Blob([writeZip(entries)], { type: 'application/zip' });
}
