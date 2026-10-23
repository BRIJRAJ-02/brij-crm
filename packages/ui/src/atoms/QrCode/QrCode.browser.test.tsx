// QrCode's column only for real content: a caller's `{cond && <Steps />}` passes `false`, and that must keep the
// plain code at its full size, not a side by side layout with an empty column.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QrCode } from './QrCode.tsx';

const VALUE = 'otpauth://totp/Timefix:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Timefix';
const LABEL = 'QR code for your authenticator app';

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
