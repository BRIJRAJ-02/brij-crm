// Team pages' QR codes (spec 0070, AC-7003): one page's code as PNG or SVG, and every page's as one zip, made in the
// browser from the codes the library's QrCode drew (no request). Each code is the plain one, dark on light, and encodes
// the page's address alone (`https://timefix.com/<handle>`), so it keeps working whatever the page's look becomes.
import { writeZip, type ZipEntry } from '@crm/contracts/zip';
import { qrPng, qrSvg } from './qr-png.ts';
import { teamStrings } from './team-strings.ts';

/** How many pixels a side a downloaded code is: the link page's own Download size. */
export const TEAM_QR_SIZE = 1024;

/** One drawn code to save: its page's handle and the SVG the page drew. */
export interface DrawnTeamCode {
  readonly handle: string;
  readonly svg: SVGSVGElement;
}

/** One code as a file: `<handle>-qr.png` or `.svg`. */
export async function teamCodeFile(
  code: DrawnTeamCode,
  format: 'png' | 'svg',
): Promise<{ readonly blob: Blob; readonly name: string }> {
  const blob = format === 'png' ? await qrPng(code.svg, TEAM_QR_SIZE) : await qrSvg(code.svg, TEAM_QR_SIZE);
  return { blob, name: `${teamStrings.fileStem(code.handle)}.${format}` };
}

/** Every code as one zip of PNG files, one a page, named by its handle (handles are unique, so names are too). */
export async function zipTeamCodes(codes: readonly DrawnTeamCode[]): Promise<Blob> {
  const entries: ZipEntry[] = [];
  for (const code of codes) {
    const file = await teamCodeFile(code, 'png');
    entries.push({ name: file.name, bytes: new Uint8Array(await file.blob.arrayBuffer()) });
  }
  return new Blob([writeZip(entries)], { type: 'application/zip' });
}
