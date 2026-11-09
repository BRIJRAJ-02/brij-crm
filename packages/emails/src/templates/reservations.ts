// The reservation page's double opt-in (9 November 2026): a guest ticked "Send me news and offers" on a table
// reservation, and the tick counts only once they confirm from this email. One line and one button: it names the
// business and when the link stops working, and carries nothing of the reservation, so forwarding it gives nothing
// away. The page the button opens asks once more before anything is saved, since link scanners open links too. Its
// heading and button use the page's own words.
import type { ReservationNewsEmail } from '@crm/contracts/emails';
import { formatShortMoment } from '../format.ts';
import { clip, type Template } from '../template.ts';

/** The subject and heading of the double opt-in: the confirm page's own heading. */
export const reservationNewsSubject = (business: string): string => `Get news from ${business}?`;

/** Asks a guest to confirm the news and offers they ticked on a reservation. */
export const reservationNews: Template<ReservationNewsEmail> = (params, context) => {
  const until = formatShortMoment(params.expiresAt, params.timeZone);
  const opening = `You asked ${params.business} for news and offers. Press Yes to confirm. This link works until ${until}.`;
  const subject = reservationNewsSubject(params.business);
  return {
    subject,
    preheader: clip(opening, 140),
    eyebrow: params.business,
    heading: subject,
    blocks: [
      { type: 'paragraph', text: opening },
      { type: 'button', label: 'Yes, send me news', url: context.link(params.confirmPath) },
      { type: 'paragraph', text: 'Didn’t ask? Ignore this email and you won’t get any.' },
    ],
    why: `You got this email because this address ticked news and offers when reserving a table at ${params.business}.`,
  };
};
