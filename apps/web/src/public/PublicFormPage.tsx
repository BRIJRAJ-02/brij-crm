// Brief
// Purpose: the hosted form a visitor fills in at /f/<publicKey> (spec 0023, AC-587), outside the CRM app.
// Main task: answer the questions and send them, then read the thank you (or go where the form sends them).
// Leaves out: steps, conditions, consent, prefill, the offline retry queue and branding (later milestones).
import {
  browserPattern,
  checkAnswers,
  formStrings,
  type PublicForm,
  type PublicFormClient,
} from '@crm/data/public-form';
import { AuthLayout, Skeleton, VisuallyHidden, type FormRefusal } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { FormFields } from './FormFields.tsx';
import { strings } from './strings.ts';

/** What the page shows. */
type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'closed'; readonly title: string; readonly message: string }
  | { readonly kind: 'form'; readonly form: PublicForm }
  | { readonly kind: 'done'; readonly title: string; readonly message: string };

/** UTM tags, the page's address without other query values, and the referrer (AC-591). */
function hiddenFields(): Record<string, string> {
  const query = new URLSearchParams(window.location.search);
  const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].flatMap(
    (key): [string, string][] => {
      const value = query.get(key);
      return value === null || value === '' ? [] : [[key, value.slice(0, 200)]];
    },
  );
  return {
    ...Object.fromEntries(utm),
    page: `${window.location.origin}${window.location.pathname}`,
    ...(document.referrer === '' ? {} : { referrer: document.referrer.slice(0, 2_048) }),
  };
}

/** Where a redirect may go: an absolute http(s) address only. */
export function safeRedirect(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** Props for the hosted form page. */
export interface PublicFormPageProps {
  readonly publicKey: string;
  readonly client: PublicFormClient;
  /** Loads reCAPTCHA for a site key and answers its token getter (`loadCaptcha`). */
  readonly captcha: (siteKey: string) => () => Promise<string | undefined>;
}

/** The hosted form page. */
export function PublicFormPage({ publicKey, client, captcha }: PublicFormPageProps) {
  const [shown, setShown] = useState<Shown>({ kind: 'loading' });
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const [isBusy, setBusy] = useState(false);
  // One key per attempt, kept for every retry of it (AC-555).
  const attempt = useRef<string | undefined>(undefined);
  const firstTouch = useRef<number | undefined>(undefined);
  const honeypot = useRef<HTMLInputElement>(null);
  const token = useRef<(() => Promise<string | undefined>) | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void client.load(publicKey).then((loaded) => {
      if (!current) return;
      if (loaded.kind !== 'form') {
        setShown({ kind: loaded.kind });
        return;
      }
      const { form } = loaded;
      document.title = form.title;
      if (form.status === 'paused') {
        setShown({
          kind: 'closed',
          title: form.title,
          message: form.closedMessage ?? formStrings(form.language).closed,
        });
        return;
      }
      if (form.recaptchaSiteKey !== undefined) token.current = captcha(form.recaptchaSiteKey);
      setShown({ kind: 'form', form });
    });
    return () => {
      current = false;
    };
  }, [client, publicKey, captcha]);

  if (shown.kind === 'loading') {
    return (
      <AuthLayout title={strings.loading} isBusy>
        <Skeleton lines={4} />
      </AuthLayout>
    );
  }
  if (shown.kind === 'missing' || shown.kind === 'failed') {
    return (
      <AuthLayout title={shown.kind === 'missing' ? strings.missingTitle : strings.failedTitle}>
        <p>{shown.kind === 'missing' ? strings.missing : strings.failed}</p>
      </AuthLayout>
    );
  }
  if (shown.kind === 'closed' || shown.kind === 'done') {
    return (
      <AuthLayout title={shown.title}>
        <p role={shown.kind === 'done' ? 'status' : undefined}>{shown.message}</p>
      </AuthLayout>
    );
  }

  const { form } = shown;
  const words = formStrings(form.language);

  const send = async (given: Readonly<Record<string, unknown>>) => {
    if (isBusy) return;
    const checked = checkAnswers(form, given, { pattern: browserPattern });
    if (!checked.ok) {
      setRefusals([]);
      setFieldErrors(checked.fields);
      return;
    }
    setBusy(true);
    setFieldErrors({});
    setRefusals([]);
    attempt.current ??= crypto.randomUUID();
    const captchaToken = token.current === undefined ? undefined : await token.current();
    const outcome = await client.submit(publicKey, {
      idempotencyKey: attempt.current,
      versionNumber: form.versionNumber,
      answers: checked.answers,
      hidden: hiddenFields(),
      ...(captchaToken === undefined ? {} : { captcha: captchaToken }),
      honeypot: honeypot.current?.value ?? '',
      fillMs: firstTouch.current === undefined ? 0 : Math.round(performance.now() - firstTouch.current),
    });
    setBusy(false);
    switch (outcome.kind) {
      case 'done': {
        if (outcome.next.kind === 'redirect') {
          const to = safeRedirect(outcome.next.url);
          if (to !== undefined) {
            setShown({ kind: 'done', title: form.title, message: strings.redirecting });
            window.location.assign(to);
            return;
          }
        }
        setShown({
          kind: 'done',
          title: form.title,
          message: outcome.next.kind === 'message' ? outcome.next.text : strings.thanks,
        });
        return;
      }
      case 'invalid':
        // The server's check, on the version it holds: a new attempt once fixed.
        attempt.current = undefined;
        setFieldErrors(outcome.fields);
        return;
      case 'closed':
        setShown({ kind: 'closed', title: form.title, message: words.closed });
        return;
      case 'changed':
        window.location.reload();
        return;
      case 'limited':
        setRefusals([{ code: 'RATE_LIMITED', message: words.tooMany }]);
        return;
      case 'failed':
        // The same attempt goes again on the next press: the server keeps it once.
        setRefusals([{ code: 'INTERNAL', message: words.failed }]);
        return;
    }
  };

  const touch = () => {
    firstTouch.current ??= performance.now();
  };

  return (
    <AuthLayout title={form.title} {...(form.description === undefined ? {} : { description: form.description })}>
      <div onFocusCapture={touch} onInputCapture={touch} onPointerDownCapture={touch}>
        <FormFields
          form={form}
          isBusy={isBusy}
          refusals={refusals}
          fieldErrors={fieldErrors}
          onAnswered={(questionId) => {
            if (fieldErrors[questionId] !== undefined) {
              setFieldErrors(({ [questionId]: _dropped, ...rest }) => rest);
            }
          }}
          onSubmit={(answers) => {
            void send(answers);
          }}
        >
          {/* The honeypot (AC-584): out of sight and out of the tab order; a person never fills it. */}
          <VisuallyHidden>
            <span aria-hidden="true">
              <input ref={honeypot} name="crm_hp" tabIndex={-1} autoComplete="off" defaultValue="" />
            </span>
          </VisuallyHidden>
        </FormFields>
      </div>
      {form.recaptchaSiteKey !== undefined && <p>{words.recaptchaNotice}</p>}
    </AuthLayout>
  );
}
