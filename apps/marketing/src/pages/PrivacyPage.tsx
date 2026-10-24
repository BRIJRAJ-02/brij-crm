/**
 * /privacy: Timefix's privacy policy. Its text is ported unchanged from
 * timefixmarketing on 23 Oct 2026. Google's OAuth verification reads /privacy,
 * so the Limited Use paragraph under "How we use Google user data" must stay
 * word for word.
 */
import { Link } from '@crm/ui';
import { LegalHeading, LegalList, LegalPage, LegalParagraph } from '../components/LegalPage/LegalPage.tsx';

/** The privacy page's document title and meta description. */
export const PRIVACY_META = {
  title: 'Privacy Policy',
  description: 'What Timefix collects, how Google Calendar data is used, and how to delete your data.',
} as const;

/** The privacy policy: what Timefix collects, how it uses Google user data, and how to delete it. */
export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="August 24, 2026">
      <LegalParagraph>
        Timefix (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a scheduling service: you share a link like
        timefix.com/yourname, and visitors book time with you - by picking a slot or by telling the page when works for
        them. This policy explains what we collect on timefix.ai, app.timefix.ai and timefix.com, why, and the choices
        you have. It applies to hosts (people with a Timefix account), guests (people who book time with a host), and
        anyone who sends an enquiry through a Timefix form that a business has put on their own website - the last of
        whom may never have seen a Timefix page at all, which is why they have a section of their own below.
      </LegalParagraph>

      <LegalHeading>What we collect</LegalHeading>
      <LegalParagraph>If you sign up as a host, we collect:</LegalParagraph>
      <LegalList>
        <li>
          <strong>Your Google account basics</strong> - name, email address and profile photo, provided by Google when
          you sign in.
        </li>
        <li>
          <strong>Google Calendar data</strong> - with your permission, when your calendar is busy (so we never offer a
          taken slot), the events Timefix creates on your calendar for confirmed bookings, and - only to draw your own
          week back to you inside your dashboard - the title, time and link of the events already on your calendar.
        </li>
        <li>
          <strong>Your settings</strong> - handle, availability rules, timezone, event types, and the bookings made with
          you.
        </li>
      </LegalList>
      <LegalParagraph>If you book time with a host as a guest, we collect:</LegalParagraph>
      <LegalList>
        <li>
          <strong>Booking details</strong> - your name, email address, the time you chose, your timezone, party size
          where relevant, and any note you add.
        </li>
        <li>
          <strong>Conversation transcripts</strong> - what you type to the booking assistant on a host&rsquo;s page,
          kept so the host has context for the meeting and so we can improve the assistant. Every message is understood
          entirely on our own servers, by our own code. No AI service reads what you type, and nothing you type to the
          assistant is sent to any third party.
        </li>
      </LegalList>
      <LegalParagraph>
        If you send an enquiry through a Timefix form on a business&rsquo;s website, we collect:
      </LegalParagraph>
      <LegalList>
        <li>
          <strong>What you typed</strong> - the answers you gave to that business&rsquo;s questions. Which questions
          they are is up to them; typically a name, an email address, a phone number, a company and what you are looking
          for.
        </li>
        <li>
          <strong>Where the form was</strong> - the address of the page you filled it in on, the page you came from
          before it, and any campaign tags in the link that brought you there. This is how the business knows which of
          their pages and adverts produce enquiries.
        </li>
      </LegalList>
      <LegalParagraph>
        <strong>The form sets no cookies and loads no analytics.</strong> It does not read anything from your browser,
        does not know whether you have used Timefix before, and adds no tracking to the website you are on.
      </LegalParagraph>
      <LegalParagraph>
        We also use analytics to understand how the site performs and where people get stuck signing up: Vercel
        Analytics and Speed Insights (aggregate traffic and page-performance metrics),{' '}
        <strong>Google Analytics 4</strong> (visits, referral source and the steps of the signup funnel), and{' '}
        <strong>Microsoft Clarity</strong> (heatmaps and session replay of the signup flow, so we can see where it
        breaks). Clarity records interactions with pages &mdash; clicks, scrolling and page content &mdash; and masks
        text input by default. Google Analytics and Clarity run in production only, and both set their own cookies. We
        do not run advertising or retargeting tags, and we do not sell personal information to anyone.
      </LegalParagraph>

      <LegalHeading>How we use Google user data</LegalHeading>
      <LegalParagraph>
        Timefix requests Google&rsquo;s <em>calendar.freebusy</em> and <em>calendar.events</em> scopes, and uses them
        for exactly three things:
      </LegalParagraph>
      <LegalList>
        <li>
          <strong>Reading availability</strong> - we check your calendar&rsquo;s free/busy status to compute which slots
          to offer. This returns busy and free intervals only, never titles, guests or notes, and it is what every
          visitor to your booking page sees the effect of: an hour is simply absent, never labelled. Results are cached
          for at most 60 seconds.
        </li>
        <li>
          <strong>Creating bookings</strong> - when a guest books, we create the event on your calendar and invite the
          guest, so both sides get a normal calendar invitation. If a booking is moved or cancelled - by you or by the
          guest - we update or delete that same event, and we read it back so that a change you make in Google Calendar
          directly is reflected in Timefix rather than the two drifting apart.
        </li>
        <li>
          <strong>Showing you your own week</strong> - the Bookings page in your dashboard draws your real calendar
          alongside your Timefix bookings, so the titles and times of your existing events are read and shown back to
          you. When one of those events already has a Google Meet link, we read that too, so you can join it from the
          same screen. This is the one place event contents are read at all: they are never shown to a guest, never sent
          anywhere else, and are held only in the same 60-second cache as free/busy.
        </li>
      </LegalList>
      <LegalParagraph>
        Timefix&rsquo;s use and transfer of information received from Google APIs adheres to the{' '}
        <Link href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </Link>
        , including the Limited Use requirements. We do not use Google user data for advertising, do not sell it, do not
        let humans read it except with your consent or for security and abuse investigation, and do not use it to
        develop, improve or train generalized AI or machine-learning models.
      </LegalParagraph>

      <LegalHeading>Enquiry forms on other websites</LegalHeading>
      <LegalParagraph>
        A business with a Timefix account can put an enquiry form on their own site, or share a link to one we host. If
        you send an enquiry that way,{' '}
        <strong>that business decides what the form asks and what happens to your answers</strong>- not us. In
        data-protection terms they are the controller of what you sent and we are their processor: we store it, show it
        to them, and act on their instructions about it.
      </LegalParagraph>
      <LegalParagraph>What that means in practice, plainly:</LegalParagraph>
      <LegalList>
        <li>
          <strong>Your answers go to that business, and only to them.</strong> They are stored under their account,
          visible to them, and not shared with other Timefix customers, sold, or used to build a profile of you anywhere
          else in the product.
        </li>
        <li>
          <strong>We keep exactly what was sent.</strong> The submission is stored as it arrived and is never rewritten,
          so the business always has the original of what you told them. If their page sent along anything extra beyond
          the questions you answered, that is kept too.
        </li>
        <li>
          <strong>Refused enquiries are kept, not deleted.</strong> If our filters judge a submission to be automated,
          or it arrives without a usable email address, it is stored and marked as refused rather than thrown away - so
          a real enquiry wrongly refused can still be found and answered.
        </li>
        <li>
          <strong>To correct or delete an enquiry, ask the business you sent it to.</strong> They can act on it
          directly. If it is easier to ask us, email us and we will pass the request to them and see it through.
        </li>
      </LegalList>

      <LegalHeading>Where your data lives</LegalHeading>
      <LegalParagraph>
        Timefix runs on a small set of infrastructure providers, each used only to operate the service: Vercel (hosting,
        delivery and aggregate analytics), Neon (our Postgres database, hosted on AWS in the United States), Upstash (a
        short-lived cache), Resend (sending booking confirmation emails), Google (the calendar operations described
        above, and Google Analytics), Microsoft (Clarity, described above), and OpenAI (the assistant our customers use,
        described next). Data is encrypted in transit and at rest, and calendar tokens are stored server-side only -
        they never reach a browser.
      </LegalParagraph>

      <LegalHeading>The assistant our customers use</LegalHeading>
      <LegalParagraph>
        A business with a Timefix account has an assistant inside their own dashboard. When they ask it a question, we
        send that question and the records needed to answer it to <strong>OpenAI</strong>, which processes them on our
        behalf and returns an answer. <strong>Those records can describe you</strong> - your name, a meeting you booked,
        a task or a note the business wrote about you, or an enquiry you sent through their form.
      </LegalParagraph>
      <LegalParagraph>
        Three things are true of it, and they are limits in our code rather than promises about how it gets used:
      </LegalParagraph>
      <LegalList>
        <li>
          <strong>Nothing you type to the booking assistant is ever sent.</strong> Conversation transcripts are not
          readable by the dashboard assistant at all - there is no way for it to reach them.
        </li>
        <li>
          <strong>It can only read what that business can already see.</strong> It answers from their own account and
          never from another&rsquo;s, and never from anything the person asking could not already open on their own
          screen.
        </li>
        <li>
          <strong>It cannot change anything on its own.</strong> It can offer to create a task or a record, and a person
          has to read that offer and confirm it before anything is written.
        </li>
      </LegalList>
      <LegalParagraph>
        <strong>
          The assistant on a host&rsquo;s booking page - the one you type to when you book - does not use OpenAI or any
          other AI service.
        </strong>{' '}
        Every message there is still understood entirely on our own servers, by our own code, exactly as described
        above.
      </LegalParagraph>

      <LegalHeading>Cookies</LegalHeading>
      <LegalParagraph>Timefix sets cookies for three purposes:</LegalParagraph>
      <LegalList>
        <li>
          <strong>Signing you in</strong> &mdash; a session cookie scoped to app.timefix.ai, set only for hosts with an
          account.
        </li>
        <li>
          <strong>Knowing where a signup came from</strong> &mdash; two first-party cookies, <em>tf_aid</em> (an
          anonymous visit id) and <em>tf_attr</em> (the referral source, such as a search engine or a campaign link),
          set on the marketing home page. They contain no name, email or other identifying detail.
        </li>
        <li>
          <strong>Analytics</strong> &mdash; Google Analytics and Microsoft Clarity set their own cookies in production,
          as described above.
        </li>
      </LegalList>
      <LegalParagraph>
        You can clear or block these in your browser at any time; the only one the product needs to work is the session
        cookie.
      </LegalParagraph>

      <LegalHeading>Retention and deletion</LegalHeading>
      <LegalList>
        <li>
          Hosts can disconnect Google Calendar at any time from the Connections page - this revokes Timefix&rsquo;s
          access with Google and deletes our stored tokens immediately.
        </li>
        <li>
          Bookings, contacts, transcripts and enquiries are kept while the host&rsquo;s account is active, so their
          history keeps working. If the account is deleted, everything in it goes with it, enquiries included.
        </li>
        <li>
          To delete your account and its data entirely - or, as a guest, to ask what a booking stored about you and have
          it removed - email us and we will complete the request within 30 days.
        </li>
      </LegalList>

      <LegalHeading>Your rights</LegalHeading>
      <LegalParagraph>
        You can ask us for a copy of the personal information we hold about you, ask us to correct it, or ask us to
        delete it. Depending on where you live, local law may give you further rights; we honor requests regardless of
        where you are.
      </LegalParagraph>

      <LegalHeading>Children</LegalHeading>
      <LegalParagraph>
        Timefix is not directed at children under 16, and we do not knowingly collect their personal information.
      </LegalParagraph>

      <LegalHeading>Changes</LegalHeading>
      <LegalParagraph>
        If this policy changes materially, we will update this page and its date, and notify hosts by email for
        significant changes.
      </LegalParagraph>

      <LegalHeading>Contact</LegalHeading>
      <LegalParagraph>
        Questions or requests: <Link href="mailto:privacy@timefix.com">privacy@timefix.com</Link>.
      </LegalParagraph>
    </LegalPage>
  );
}
