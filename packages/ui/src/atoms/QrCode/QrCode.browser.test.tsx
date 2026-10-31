// QrCode's column only for real content: a caller's `{cond && <Steps />}` passes `false`, and that must keep the
// plain code at its full size, not a side by side layout with an empty column. And a styled code (spec 0061,
// AC-6124) must still scan: each style is drawn in a real browser, saved the way the editor saves it (its colours
// read off the page into a standalone SVG, then a PNG), and read back with a decoder.
import jsQR from 'jsqr';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
// The tokens the code's colours come from, as every page loads them.
import '../../styles/index.css';
import { QrCode, qrModuleColour, qrPictureBox, type QrCodeProps } from './QrCode.tsx';

const VALUE = 'otpauth://totp/Timefix:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Timefix';
const LABEL = 'QR code for your authenticator app';
const ADDRESS = 'https://timefix.com/ada-lovelace?utm_source=qr&utm_medium=print';

/** How many pixels a side the saved code is: the editor's Download PNG size. */
const SAVED = 1024;

/** A square picture as a `data:` address, the centre a person might put in their code. */
function centrePicture(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No canvas');
  context.fillStyle = '#e8590c';
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = '#1f2937';
  context.fillRect(16, 16, 32, 32);
  return canvas.toDataURL('image/png');
}

/** Draws the code in the page, then saves it as the editor does and decodes the saved pixels. */
async function decodeDrawn(props: Partial<QrCodeProps>): Promise<string | undefined> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<QrCode value={ADDRESS} label="QR code" size="fill" {...props} />);
    await Promise.resolve();
  });
  try {
    const svg = host.querySelector('svg');
    if (svg === null) throw new Error('No code');
    // The colours the page drew with, written into a copy that stands on its own (qr-png.ts in the web app).
    const copy = svg.cloneNode(true);
    if (!(copy instanceof SVGSVGElement)) throw new Error('No copy');
    const drawn = svg.querySelectorAll('rect, path, text');
    copy.querySelectorAll('rect, path, text').forEach((shape, index) => {
      const from = drawn[index];
      if (from === undefined) return;
      const style = getComputedStyle(from);
      if (style.fill !== 'none') shape.setAttribute('fill', style.fill);
      if (style.stroke !== 'none') shape.setAttribute('stroke', style.stroke);
    });
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', String(SAVED));
    copy.setAttribute('height', String(SAVED));
    const source = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
    );
    const image = new Image(SAVED, SAVED);
    image.src = source;
    await image.decode();
    URL.revokeObjectURL(source);
    const canvas = document.createElement('canvas');
    canvas.width = SAVED;
    canvas.height = SAVED;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, SAVED, SAVED);
    const pixels = context.getImageData(0, 0, SAVED, SAVED);
    return jsQR(pixels.data, SAVED, SAVED)?.data;
  } finally {
    act(() => {
      root.unmount();
    });
    host.remove();
  }
}

describe('QrCode', () => {
  it('draws the plain code when the column has nothing in it', () => {
    for (const nothing of [undefined, null, false, [], [false, null]]) {
      expect(
        renderToStaticMarkup(
          <QrCode value={VALUE} label={LABEL}>
            {nothing}
          </QrCode>,
        ),
      ).toMatch(/^<svg/);
    }
  });

  it('draws the column when it has content', () => {
    const markup = renderToStaticMarkup(
      <QrCode value={VALUE} label={LABEL}>
        <p>Scan it</p>
      </QrCode>,
    );
    expect(markup).toMatch(/^<div/);
    expect(markup).toContain('<p>Scan it</p>');
  });
});

describe('a styled QR code (spec 0061, AC-6124)', () => {
  it('keeps only a colour with 4.5 to 1 against white', () => {
    expect(qrModuleColour('#1F2937')).toBe('#1f2937');
    expect(qrModuleColour('#e8590c')).toBeUndefined();
    expect(qrModuleColour('#ffff00')).toBeUndefined();
    expect(qrModuleColour('red')).toBeUndefined();
    expect(qrModuleColour(undefined)).toBeUndefined();
  });

  it('holds the centre picture to a fifth of the code, odd and centred', () => {
    const box = qrPictureBox(41);
    expect(box.side).toBe(6 - 1);
    expect(box.at * 2 + box.side).toBe(41);
    expect(box.hole).toEqual([box.at - 1, box.at + box.side + 1]);
  });

  it('scans plain, coloured, with a centre picture and framed with a label', async () => {
    expect(await decodeDrawn({})).toBe(ADDRESS);
    expect(await decodeDrawn({ colour: '#1f2937' })).toBe(ADDRESS);
    expect(await decodeDrawn({ colour: '#5b21b6', picture: centrePicture() })).toBe(ADDRESS);
    expect(await decodeDrawn({ colour: '#14532d', picture: centrePicture(), frameLabel: 'Scan me' })).toBe(ADDRESS);
  });

  it('draws a colour it refuses as the plain dark code, never a light one', () => {
    const markup = renderToStaticMarkup(<QrCode value={ADDRESS} label="QR code" colour="#ffff00" />);
    expect(markup).not.toContain('--qr-modules');
  });
});
