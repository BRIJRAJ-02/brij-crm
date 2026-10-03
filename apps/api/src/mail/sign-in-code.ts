// The "Your sign in code" email (spec 0005), a React Email template. The only
// module that imports React Email. Node runs this file without a build step,
// and type stripping has no JSX, so the elements are made with createElement.
import { createElement as h } from 'react';
import { Body, Container, Head, Heading, Html, Preview, render, Text } from 'react-email';

/** The subject every code email carries. The code itself stays out of it. */
export const SIGN_IN_CODE_SUBJECT = 'Your sign in code';

/** How long a code works, as the email says it (the email OTP plugin's `expiresIn`). */
export const SIGN_IN_CODE_MINUTES = 10;

// Email clients ignore stylesheets, so styles are inline objects.
const page = { backgroundColor: '#f6f6f4', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' };
const card = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  margin: '32px auto',
  padding: '32px',
  maxWidth: '480px',
};
const heading = { color: '#1b1b18', fontSize: '20px', fontWeight: 600, margin: '0 0 16px' };
const body = { color: '#3a3a35', fontSize: '15px', lineHeight: '22px', margin: '0 0 16px' };
const code = {
  color: '#1b1b18',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: '32px',
  fontWeight: 600,
  letterSpacing: '6px',
  margin: '8px 0 24px',
};
const muted = { color: '#6b6b63', fontSize: '13px', lineHeight: '20px', margin: '0' };

function SignInCodeEmail({ otp }: { readonly otp: string }) {
  return h(
    Html,
    { lang: 'en' },
    h(Head, null),
    h(
      Body,
      { style: page },
      h(Preview, null, `Your sign in code is ${otp}`),
      h(
        Container,
        { style: card },
        h(Heading, { as: 'h1', style: heading }, SIGN_IN_CODE_SUBJECT),
        h(Text, { style: body }, `Enter this code to sign in. It works for ${SIGN_IN_CODE_MINUTES} minutes.`),
        h(Text, { style: code }, otp),
        h(
          Text,
          { style: muted },
          "If you didn't ask for this code, you can ignore this email. Nobody can sign in without it.",
        ),
      ),
    ),
  );
}

/** The code email's subject, HTML and plain text, ready for a `Mailer`. */
export async function signInCodeEmail(otp: string): Promise<{ subject: string; html: string; text: string }> {
  const element = h(SignInCodeEmail, { otp });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: SIGN_IN_CODE_SUBJECT, html, text };
}
