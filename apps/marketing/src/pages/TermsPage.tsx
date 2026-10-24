/**
 * /terms: Timefix's terms of service. Its text is ported unchanged from
 * timefixmarketing on 23 Oct 2026. Google's OAuth consent screen links /terms
 * beside /privacy, and its verification reads /privacy, so the Limited Use
 * paragraph there must stay word for word.
 */
import { Link } from '@crm/ui';
import { LegalHeading, LegalList, LegalPage, LegalParagraph } from '../components/LegalPage/LegalPage.tsx';

/** The terms page's document title and meta description. */
export const TERMS_META = {
  title: 'Terms of Service',
  description: 'The terms that govern using Timefix as a host or booking time as a guest.',
} as const;

/** The terms of service for hosts and guests. */
export function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="August 14, 2026">
      <LegalParagraph>
        These terms govern your use of Timefix - the scheduling service at timefix.ai, app.timefix.ai and timefix.com.
        By creating an account or booking time through a Timefix page, you agree to them. If you do not agree, do not
        use the service.
      </LegalParagraph>

      <LegalHeading>The service</LegalHeading>
      <LegalParagraph>
        Timefix gives hosts a personal booking page (timefix.com/yourname) that offers times computed from their
        availability rules and Google Calendar, lets guests book by picking a slot or describing a time in plain words,
        and puts confirmed bookings on both sides&rsquo; calendars.
      </LegalParagraph>

      <LegalHeading>Accounts and Google Calendar</LegalHeading>
      <LegalList>
        <li>
          You sign in with Google and must keep control of that Google account; you are responsible for activity under
          your Timefix account.
        </li>
        <li>
          Connecting Google Calendar authorizes Timefix to read your free/busy times and create booking events on your
          behalf, as described in the <Link href="/privacy">Privacy Policy</Link>. You can disconnect at any time from
          the Connections page.
        </li>
        <li>
          Keep your availability honest: guests rely on the times your page offers, and you are responsible for honoring
          bookings your page confirms.
        </li>
      </LegalList>

      <LegalHeading>Handles</LegalHeading>
      <LegalParagraph>
        Handles are first come, first served. Certain words are reserved, and we may reclaim a handle that impersonates
        a person or brand, infringes a trademark, or sits unused on an abandoned account - we will contact you first
        where we reasonably can.
      </LegalParagraph>

      <LegalHeading>Acceptable use</LegalHeading>
      <LegalParagraph>
        Do not use Timefix to send spam, harass people, book meetings for illegal purposes, misrepresent who you are,
        probe or overload the service, or scrape other users&rsquo; pages or data. We may suspend or terminate accounts
        that do.
      </LegalParagraph>

      <LegalHeading>Pricing</LegalHeading>
      <LegalParagraph>
        Timefix is free during early access. Paid tiers will come later; when they do, we will announce them clearly in
        advance, and nothing you already booked will be held hostage behind a paywall.
      </LegalParagraph>

      <LegalHeading>Your content</LegalHeading>
      <LegalParagraph>
        You keep all rights to the information you put into Timefix. You grant us only the license needed to operate the
        service - to store it, display it on your booking page as you configure it, and transmit it to the people you
        book with.
      </LegalParagraph>

      <LegalHeading>Disclaimers</LegalHeading>
      <LegalParagraph>
        Timefix is provided &ldquo;as is&rdquo;, without warranties of any kind. We work hard to compute availability
        correctly and deliver every notification, but we cannot guarantee the service will be uninterrupted or
        error-free, and we are not a party to the meetings booked through it - hosts and guests are responsible to each
        other for showing up.
      </LegalParagraph>

      <LegalHeading>Limitation of liability</LegalHeading>
      <LegalParagraph>
        To the maximum extent permitted by law, Timefix will not be liable for indirect, incidental, special or
        consequential damages, or lost profits, arising from your use of the service. Our total liability for any claim
        is limited to the greater of the amount you paid us in the twelve months before the claim and US$100.
      </LegalParagraph>

      <LegalHeading>Termination</LegalHeading>
      <LegalParagraph>
        You can stop using Timefix and delete your account at any time. We may suspend or terminate accounts that
        violate these terms or put the service or its users at risk.
      </LegalParagraph>

      <LegalHeading>Changes</LegalHeading>
      <LegalParagraph>
        We may update these terms as the service evolves. Material changes will be posted here with a new date, and
        hosts will be notified by email. Continuing to use Timefix after a change takes effect means you accept the
        updated terms.
      </LegalParagraph>

      <LegalHeading>Contact</LegalHeading>
      <LegalParagraph>
        Questions about these terms: <Link href="mailto:privacy@timefix.ai">privacy@timefix.ai</Link>.
      </LegalParagraph>
    </LegalPage>
  );
}
