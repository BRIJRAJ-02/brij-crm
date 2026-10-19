// The hosted form page's own entry (spec 0023, 0023-experience.md, The
// visitor): a second build entry beside the app, sharing nothing with its
// shell and loading no React. It reads the address from the path
// (/f/<address>), loads the live form, draws it with the plain renderer and
// sends the answers through the public client. With `?embed=1` it is the
// iframe a site's embed script made: an h2, no page height, and the frame's
// height posted to the parent as it changes.
import '@crm/ui/styles.css';
import { createPublicFormClient, loadCaptcha } from '@crm/data/public-form';
import { mountFormMessage, mountHostedForm, type HostedSubmitOutcome } from '@crm/ui/public-form';

const root = document.querySelector<HTMLElement>('[data-app-root]');
if (root === null) throw new Error('The page has no root.');

const params = new URLSearchParams(window.location.search);
const embedded = params.get('embed') === '1' && window.parent !== window;
const mode = embedded ? 'embed' : 'page';
const address = decodeURIComponent(window.location.pathname.replace(/^\/f\//, '').split('/')[0] ?? '');
const client = createPublicFormClient();

/** The visitor's country, guessed from the browser's language (en-GB is GB), for phone and country questions. */
function guessCountry(): string | undefined {
  for (const language of navigator.languages) {
    try {
      const region = new Intl.Locale(language).maximize().region;
      if (region !== undefined && /^[A-Z]{2}$/.test(region)) return region;
    } catch {
      // A language tag the browser can't read: try the next.
    }
  }
  return undefined;
}

/** UTM tags, the page and the referrer: from this page, or from the site's page an embed passed along. */
function hiddenFields(): Record<string, string> {
  const source = embedded ? new URLSearchParams(params.get('from') ?? '') : params;
  const hidden: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const value = source.get(key) ?? params.get(key);
    if (value !== null && value !== '') hidden[key] = value.slice(0, 200);
  }
  const page = embedded ? params.get('page') : window.location.href;
  if (page !== null && page !== '') hidden.page = page.slice(0, 2_048);
  const referrer = embedded ? params.get('referrer') : document.referrer;
  if (referrer !== null && referrer !== '') hidden.referrer = referrer.slice(0, 2_048);
  return hidden;
}

/** Inside an embed, tells the parent page the drawn form's height whenever it changes. */
function postHeight(drawn: Element | null): void {
  if (!embedded || drawn === null) return;
  const send = () => {
    const height = Math.ceil(drawn.getBoundingClientRect().height);
    window.parent.postMessage({ type: 'crm-form-height', address, height }, '*');
  };
  new ResizeObserver(send).observe(drawn);
  send();
}

const loaded = await client.load(address);
if (loaded.kind !== 'form') {
  document.title = mountFormMessage(root, { mode, kind: loaded.kind }).title;
} else {
  const { form } = loaded;
  document.title = form.headline;
  document.documentElement.lang = form.language;
  document.documentElement.dataset.theme = form.look.colour;
  const captcha = form.recaptchaSiteKey === undefined ? undefined : loadCaptcha(form.recaptchaSiteKey);
  const keys = new Map<number, string>();
  mountHostedForm(root, form, {
    mode,
    countryGuess: guessCountry(),
    onRedirect: (url) => {
      if (embedded) window.open(url, '_top');
      else window.location.assign(url);
    },
    onSubmit: async (submission): Promise<HostedSubmitOutcome> => {
      const idempotencyKey = keys.get(submission.round) ?? crypto.randomUUID();
      keys.set(submission.round, idempotencyKey);
      const token = captcha === undefined ? undefined : await captcha();
      return client.submit(address, {
        idempotencyKey,
        versionNumber: form.versionNumber,
        answers: submission.answers,
        hidden: hiddenFields(),
        fillMs: Math.round(submission.fillMs),
        ...(submission.trap === '' ? {} : { company_url: submission.trap }),
        ...(token === undefined ? {} : { captcha: token }),
      });
    },
  });
}
postHeight(root.lastElementChild);
