// `@crm/emails`: every email the product sends, drawn from the design tokens
// (spec 0001's `packages/emails`). Templates turn params into words, one
// layout draws the words as HTML and plain text, and nothing here sends: the
// api's mailer does.
import { appUrl } from './links.ts';
import { renderDocument, type RenderedEmail } from './render.ts';
import { SIGN_IN_CODE_MINUTES, signInCode } from './templates/sign-in-code.ts';

export type { DocumentRow, EmailBlock, EmailDocument } from './document.ts';
export {
  appOrigin,
  appUrl,
  EMAIL_MEDIUMS,
  onAppOrigin,
  poweredByUrl,
  TIMEFIX_SITE,
  wordmarkUrls,
  type EmailMedium,
} from './links.ts';
export { documentText, headerText, renderDocument, type RenderedEmail, type RenderOptions } from './render.ts';
export { emailStylesheet, paint, ROLE_NAMES, type Role } from './theme.ts';
export type { Template, TemplateContext } from './template.ts';
export { SIGN_IN_CODE_MINUTES, SIGN_IN_CODE_SUBJECT } from './templates/sign-in-code.ts';

/** The sign in code email (spec 0005), sent in its request: the code, how long it works, and the shared footer. */
export async function renderSignInCode(code: string, context: { readonly appOrigin: string }): Promise<RenderedEmail> {
  if (!/^[0-9A-Za-z]{4,12}$/.test(code)) throw new Error('A sign in code is 4 to 12 letters and digits.');
  return renderDocument(
    signInCode({ code, minutes: SIGN_IN_CODE_MINUTES }, { link: (path) => appUrl(context.appOrigin, path) }),
    { appOrigin: context.appOrigin, medium: 'email_sign_in' },
  );
}
