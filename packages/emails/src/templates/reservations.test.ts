// The reservation page's double opt-in (9 November 2026): one button to the confirm page on the app's origin, with
// the token kept in the fragment, the business named, and nothing of the reservation.
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog.ts';
import { renderEmail } from '../index.ts';

const ORIGIN = 'https://app.example.com';

describe('the news and offers confirmation', () => {
  it('names the business, links its one button to the confirm page, and says when the link runs out', async () => {
    const sample = CATALOG.reservation_news.sample;
    const email = await renderEmail('reservation_news', sample, { appOrigin: ORIGIN, workspaceName: 'Acme' });
    expect(email.subject).toBe('Get news from The Larder?');
    expect(email.text).toContain(`Yes, send me news: ${ORIGIN}${sample.confirmPath}`);
    expect(email.text).toContain('This link works until');
    expect(email.text).toContain('Didn’t ask? Ignore this email');
  });

  it('refuses a confirm path that would leave the app’s origin', async () => {
    await expect(
      renderEmail(
        'reservation_news',
        { ...CATALOG.reservation_news.sample, confirmPath: '//evil.example/r/x' },
        { appOrigin: ORIGIN },
      ),
    ).rejects.toThrow();
  });
});
