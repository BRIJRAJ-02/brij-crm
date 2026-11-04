// The hosted form page's own entry (spec 0023, 0023-experience.md, The
// visitor): a second build entry beside the app, sharing nothing with its
// shell. It reads the address from the path (/f/<address>), loads the live
// form, draws it with `@crm/ui/public-form` (React and the library's own
// controls, under the hosted form budget in `.size-limit.js`: 223 kB of
// JavaScript and 17 kB of CSS gzipped; Steps and One at a time load as their
// own chunk, spec 0063) and sends the answers through the public client. With `?embed=1` it is the
// iframe a site's embed script (`embed/v1.js`) made: an h2, no page height,
// the frame's height posted to the host page as it changes, and Escape
// closing the script's dialog (frame.ts). Every submit carries where it came
// from (`context`); the address's own parameters prefill questions by key.
import '@crm/ui/styles.css';
import { createPublicFormClient, loadCaptcha, type FormEventBody } from '@crm/data/public-form';
import { mountFormLoading, mountFormMessage, mountHostedForm, type HostedSubmitOutcome } from '@crm/ui/public-form';
import { formCountry } from './country.ts';
import { landingOf } from './landing.ts';
import { contextFromFrame, contextOfPage, hiddenOf, prefillOf } from './context.ts';
import { closeOnEscape, embedOf, framedUrl, isOwnBookingPath, reportHeight, type PostToHost } from './frame.ts';
import { brandHref, brandLogoHref, preloadImage, wearStylesheet } from './stylesheet.ts';
import { guardPreloadErrors, hasFilledField, sessionStore } from '../preload-guard.ts';

const found = document.querySelector<HTMLElement>('[data-app-root]');
if (found === null) throw new Error('The page has no root.');
const root: HTMLElement = found;

// A tab left open across a deploy asks for a chunk the new one no longer has: reload once onto it, never over a
// half filled form. The form draws no toasts, so with answers typed the error takes its own way instead.
guardPreloadErrors({
  target: window,
  storage: () => sessionStore(window),
  now: Date.now,
  reload: () => {
    window.location.reload();
  },
  isDirty: () => hasFilledField(root),
});

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
const prefill = prefillOf(params);
// The fill this visitor is coming back to (spec 0063, AC-6319). An unknown or expired token is not an error:
// the form is drawn empty, which is what somebody following an old link should get.
const resumeAsked = params.get('resume') ?? undefined;
const address = decodeURIComponent(window.location.pathname.replace(/^\/f\//, '').split('/')[0] ?? '');
// Inside a site's frame the form is not a page of ours: it has no ground, so the tinted one its shell names
// comes off before anything paints into it.
if (embedded) delete document.documentElement.dataset.publicPage;
const client = createPublicFormClient();
// The form's own shape, drawn before the read even begins: the card, the headline's place, the questions' places
// and the button's. A visitor's first paint is then the page rather than a blank window, and the words land in
// the places already set out for them. It is taken down in the same frame the real view goes up, so the page
// never shows both and never shows neither.
// Its layout and look are not known until the read answers, so the shape is the neutral one (no card, the visitor's
// own light or dark): nothing it draws is taken away when a One at a time or a dark form arrives (spec 0063, AC-6306).
const loading = mountFormLoading(root, mode, 'unknown');
// The loading card has a height of its own, so a site's frame is sized to it at once rather than clipping it
// until the form arrives.
let stopHeight = postHeight(root.lastElementChild);

/**
 * The answers a resumed fill brings, in the shape `prefill` takes: text and lists of text. Anything else the
 * server kept (a number, a date) is given as its own text, which every question reads back the way it wrote it.
 */
function resumedPrefill(answers: Readonly<Record<string, unknown>>): Record<string, string | readonly string[]> {
  const out: Record<string, string | readonly string[]> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.filter((each): each is string => typeof each === 'string');
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

/**
 * Where the visit came from, for the by source table (AC-6321): the UTM source the address carries, else the
 * site that linked here. The server cuts it to a host or a word; a visit with neither is Direct, which it
 * reads as the absence of this rather than a value of its own.
 */
function sourceOf(context: ReturnType<typeof contextNow>): string | undefined {
  return context.utm_source ?? context.referrer;
}

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
  const loaded = await client.load(address, resumeAsked);
  if (loaded.kind !== 'form') {
    const message = mountFormMessage(root, { mode, kind: loaded.kind });
    stopHeight();
    loading.destroy();
    document.title = message.title;
  } else {
    let form = loaded.form;
    // An old address still finds the form (late trap #54): the page moves to its current one in place, keeping the
    // query (prefill, UTM tags). Never inside a site's frame, whose address is the site's embed's own.
    if (!embedded && form.key !== address) {
      window.history.replaceState(
        window.history.state,
        '',
        `/f/${form.key}${window.location.search}${window.location.hash}`,
      );
    }
    document.title = form.headline;
    document.documentElement.lang = form.language;
    // A template that pins its scheme (spec 0068: Night dark, Studio light) wins over the form's own Colour, on the
    // root as well, so the foot's mark and the popovers outside the card take the same scheme.
    const template = form.brand?.template;
    document.documentElement.dataset.theme =
      template === 'night' ? 'dark' : template === 'studio' ? 'light' : form.look.colour;
    // On the root too, so the lists that open outside the form (in a popover) square their corners with it.
    document.documentElement.dataset.corners = form.look.corners;
    // The workspace's brand (spec 0060, AC-4), linked from our own api and waited on a moment, so the form draws in
    // its colour from the first frame rather than turning to it, and its logo decoded so it never paints in late.
    await Promise.all([
      wearStylesheet(document, brandHref('forms', form.key, form.brand?.version)),
      preloadImage(brandLogoHref('forms', form.key, form.brand?.logo)),
    ]);
    const captcha = form.recaptchaSiteKey === undefined ? undefined : loadCaptcha(form.recaptchaSiteKey);
    const keys = new Map<number, string>();
    // A fill ticket per round (the spam checks): asked for as the page loads, and for the next round as one is
    // sent, so the server's clock times the filling. Without one the submit still goes.
    const tickets = new Map<number, Promise<string | undefined>>([[0, client.ticket(address)]]);
    // The form's own counts (spec 0063, AC-6320), on the same ticket the submit carries: without one the
    // server counts nothing, so every beacon waits for the first ticket rather than racing it.
    const firstTicket = tickets.get(0) ?? Promise.resolve(undefined);
    const visit = contextNow();
    const source = sourceOf(visit);
    // The landing address's UTM tags and click id presence, and the referrer beside them (spec 0067, AC-6703).
    const landing = landingOf(visit.landing_url ?? window.location.href);
    const referrer = visit.referrer;
    const countIt = (body: Omit<FormEventBody, 'ticket' | 'source' | 'landing' | 'referrer'>) => {
      void firstTicket.then((ticket) => {
        client.event(address, {
          ...body,
          ...(ticket === undefined ? {} : { ticket }),
          ...(source === undefined ? {} : { source }),
          ...(landing === undefined ? {} : { landing }),
          ...(referrer === undefined ? {} : { referrer: referrer.slice(0, 400) }),
        });
      });
    };
    countIt({ kind: 'view' });
    // Save and resume. The token belongs here rather than in the form's state: which partial this is, is
    // between the page and the server. The first save has none and the server answers one; every save after
    // carries it, so one visitor leaves one partial however many times they are saved.
    // Only a token the server actually resumed is kept: an unknown or expired one names no partial, so a save
    // carrying it would be asking to update something that is not there. Without it the first save makes a new one.
    let resumeToken = form.resumed === undefined ? undefined : resumeAsked;
    const resumeUrlOf = (token: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set('resume', token);
      // The link carries the token and nothing else of the visit (AC-6330): no answers, no email, no name.
      for (const key of [...url.searchParams.keys()]) if (key !== 'resume') url.searchParams.delete(key);
      return url.toString();
    };
    // A site's inline embed may ask for a clear ground and no headline (the Share tab's switches).
    if (embed?.isTransparent === true) document.documentElement.dataset.ground = 'none';
    const drawn = mountHostedForm(root, form, {
      mode,
      ...(embed === undefined
        ? {}
        : { embedLook: { isTransparent: embed.isTransparent, isTitleHidden: embed.isTitleHidden } }),
      countryGuess: formCountry(form.country),
      // The answers that came back take the link's own prefill: a visitor coming back wants what they typed,
      // not what the address suggested the first time.
      prefill: form.resumed === undefined ? prefill : { ...prefill, ...resumedPrefill(form.resumed.answers) },
      ...(form.resumed?.stepId === undefined ? {} : { resumedStepId: form.resumed.stepId }),
      onRedirect: (url) => {
        // A booking page of ours carries on inside the same frame, still sized to its content; any other address
        // takes the whole window, out of the site's frame.
        if (embed !== undefined && isOwnBookingPath(url)) window.location.assign(framedUrl(url, embed));
        else if (embedded) window.open(url, '_top');
        else window.location.assign(url);
      },
      onUpload: (file, onProgress) => client.upload(address, file, onProgress),
      onRemoveUpload: (fileId) => client.removeUpload(address, fileId),
      // Published again while this page was open (late trap #18): the new version is drawn in place, the same form
      // keyed the same, so every answer given stays by its question's key.
      onStale: async () => {
        const fresh = await client.load(address);
        if (fresh.kind !== 'form' || fresh.form.versionNumber === form.versionNumber) return false;
        form = fresh.form;
        await wearStylesheet(document, brandHref('forms', form.key, form.brand?.version));
        drawn.update(form);
        return true;
      },
      // Never inside a site's frame: the visitor's address bar is the site's, so a link built from it would
      // bring them back to the site's page and not to this form (and `window.location` is the frame's own).
      ...(embedded
        ? {}
        : {
            onSave: async (fill) => {
              const ticket = await firstTicket;
              const saved = await client.savePartial(address, {
                answers: fill.answers,
                versionNumber: form.versionNumber,
                ...(fill.stepId === undefined ? {} : { stepId: fill.stepId }),
                ...(resumeToken === undefined ? {} : { resumeToken }),
                ...(ticket === undefined ? {} : { ticket }),
              });
              if (saved === undefined) return undefined;
              resumeToken = saved.resumeToken;
              return {
                resumeToken: saved.resumeToken,
                resumeUrl: resumeUrlOf(saved.resumeToken),
                expiresAt: saved.expiresAt,
              };
            },
            onEmailResume: async (token) => {
              const ticket = await firstTicket;
              return client.emailResumeLink(address, {
                resumeToken: token,
                ...(ticket === undefined ? {} : { ticket }),
              });
            },
          }),
      onCount: (count) => {
        countIt(count.kind === 'start' ? { kind: 'start' } : { kind: 'reach', questionId: count.questionId });
      },
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
