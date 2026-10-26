// The hosted form page's own entry (spec 0023, 0023-experience.md, The
// visitor): a second build entry beside the app, sharing nothing with its
// shell and loading no React. It reads the address from the path
// (/f/<address>), loads the live form, draws it with the plain renderer and
// sends the answers through the public client. With `?embed=1` it is the
// iframe a site's embed script (`embed/v1.js`) made: an h2, no page height,
// the frame's height posted to the host page as it changes, and Escape
// closing the script's dialog (frame.ts). Every submit carries where it came
// from (`context`); the address's own parameters prefill questions by key.
import '@crm/ui/styles.css';
import { createPublicFormClient, loadCaptcha } from '@crm/data/public-form';
import { mountFormLoading, mountFormMessage, mountHostedForm, type HostedSubmitOutcome } from '@crm/ui/public-form';
import { guessCountry } from './country.ts';
import { contextFromFrame, contextOfPage, hiddenOf } from './context.ts';
import { closeOnEscape, embedOf, framedUrl, isOwnBookingPath, reportHeight, type PostToHost } from './frame.ts';

const found = document.querySelector<HTMLElement>('[data-app-root]');
if (found === null) throw new Error('The page has no root.');
const root: HTMLElement = found;

const params = new URLSearchParams(window.location.search);
const embed = embedOf({
  search: window.location.search,
  isFramed: window.parent !== window,
  // Firefox has no ancestor list.
  ancestorOrigins: 'ancestorOrigins' in window.location ? [...window.location.ancestorOrigins] : undefined,
});
const embedded = embed !== undefined;
const mode = embedded ? 'embed' : 'page';
const postToHost: PostToHost = (message, targetOrigin) => {
  window.parent.postMessage(message, targetOrigin);
};
// Escape closes the script's dialog from the first moment, even before the form has loaded.
if (embed !== undefined) closeOnEscape(embed, postToHost, window);
/** The address's parameters the embed script and the page use themselves: never a question's prefill. */
const RESERVED = new Set(['embed', 'mode', 'fid', 'host', 'ctx', 'page', 'referrer', 'from']);
const prefill = Object.fromEntries([...params].filter(([key]) => !RESERVED.has(key) && !key.startsWith('utm_')));
const address = decodeURIComponent(window.location.pathname.replace(/^\/f\//, '').split('/')[0] ?? '');
// Inside a site's frame the form is not a page of ours: it has no ground, so the tinted one its shell names
// comes off before anything paints into it.
if (embedded) delete document.documentElement.dataset.publicPage;
const client = createPublicFormClient();
// The form's own shape, drawn before the read even begins: the card, the headline's place, the questions' places
// and the button's. A visitor's first paint is then the page rather than a blank window, and the words land in
// the places already set out for them. It is taken down in the same frame the real view goes up, so the page
// never shows both and never shows neither.
const loading = mountFormLoading(root, mode);
// The loading card has a height of its own, so a site's frame is sized to it at once rather than clipping it
// until the form arrives.
let stopHeight = postHeight(root.lastElementChild);

/** Where this visit came from: the site's page an embed passed along, or this page itself. */
function contextNow() {
  return embed === undefined
    ? contextOfPage({ href: window.location.href, title: document.title, referrer: document.referrer })
    : contextFromFrame(window.location.search, embed.mode);
}

/** Inside an embed, tells the host page the drawn form's height whenever it changes; answers the stop. */
function postHeight(drawn: Element | null): () => void {
  if (embed === undefined || drawn === null) return () => undefined;
  return reportHeight(
    embed,
    postToHost,
    () => drawn.getBoundingClientRect().height,
    (changed) => {
      const observer = new ResizeObserver(changed);
      observer.observe(drawn);
      return () => {
        observer.disconnect();
      };
    },
  );
}

/**
 * Loads the live form and draws it, or the message that stands in for it. A function, not top level
 * `await`: one top level await anywhere in the build turns off Rolldown's chunk merging for every entry,
 * which split the app's first load into 65 files and cost it 42 kB gzipped (21 October 2026).
 */
async function start(): Promise<void> {
  const loaded = await client.load(address);
  if (loaded.kind !== 'form') {
    const message = mountFormMessage(root, { mode, kind: loaded.kind });
    stopHeight();
    loading.destroy();
    document.title = message.title;
  } else {
    const { form } = loaded;
    document.title = form.headline;
    document.documentElement.lang = form.language;
    document.documentElement.dataset.theme = form.look.colour;
    // On the root too, so the lists that open outside the form (in a popover) square their corners with it.
    document.documentElement.dataset.corners = form.look.corners;
    const captcha = form.recaptchaSiteKey === undefined ? undefined : loadCaptcha(form.recaptchaSiteKey);
    const keys = new Map<number, string>();
    // A fill ticket per round (the spam checks): asked for as the page loads, and for the next round as one is
    // sent, so the server's clock times the filling. Without one the submit still goes.
    const tickets = new Map<number, Promise<string | undefined>>([[0, client.ticket(address)]]);
    mountHostedForm(root, form, {
      mode,
      countryGuess: guessCountry(),
      prefill,
      onRedirect: (url) => {
        // A booking page of ours carries on inside the same frame, still sized to its content; any other address
        // takes the whole window, out of the site's frame.
        if (embed !== undefined && isOwnBookingPath(url)) window.location.assign(framedUrl(url, embed));
        else if (embedded) window.open(url, '_top');
        else window.location.assign(url);
      },
      onUpload: (file, onProgress) => client.upload(address, file, onProgress),
      onRemoveUpload: (fileId) => client.removeUpload(address, fileId),
      onSubmit: async (submission): Promise<HostedSubmitOutcome> => {
        const idempotencyKey = keys.get(submission.round) ?? crypto.randomUUID();
        keys.set(submission.round, idempotencyKey);
        const token = captcha === undefined ? undefined : await captcha();
        const ticket = await (tickets.get(submission.round) ?? Promise.resolve(undefined));
        const context = contextNow();
        const outcome = await client.submit(address, {
          idempotencyKey,
          versionNumber: form.versionNumber,
          answers: submission.answers,
          hidden: hiddenOf(context),
          context,
          fillMs: Math.round(submission.fillMs),
          ...(submission.trap === '' ? {} : { company_url: submission.trap }),
          ...(token === undefined ? {} : { captcha: token }),
          ...(ticket === undefined ? {} : { ticket }),
        });
        if (outcome.kind === 'done' && !tickets.has(submission.round + 1)) {
          tickets.set(submission.round + 1, client.ticket(address));
        }
        return outcome;
      },
    });
    stopHeight();
    loading.destroy();
  }
  stopHeight = postHeight(root.lastElementChild);
}

void start();
