// Purpose: the hosted form a visitor fills in at /f/<publicKey> (spec 0023, AC-587), outside the CRM app.
// Main task: answer the questions and send them, then read the thank you (or go where the form sends them).
// Leaves out: steps, conditions, consent, prefill, the offline retry queue and branding (later milestones).
import {
  browserPattern,
  checkAnswers,
  formStrings,
  type PublicForm,
  type PublicFormClient,
  type PublicQuestion,
} from '@crm/data/public-form';
import {
  AttributeEditor,
  AuthLayout,
  Form,
  Separator,
  Skeleton,
  VisuallyHidden,
  type FieldAttribute,
  type FormRefusal,
} from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { strings } from './strings.ts';

/** What the page shows. */
type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'closed'; readonly title: string; readonly message: string }
  | { readonly kind: 'form'; readonly form: PublicForm }
  | { readonly kind: 'done'; readonly title: string; readonly message: string };

/** A question as the field set's attribute: its one editor, asked for on submit. */
function attributeOf(question: PublicQuestion): FieldAttribute {
  return {
    id: question.id,
    name: question.label,
    type: question.type,
    allowMultiple: question.isMulti,
    ...(question.options === undefined
      ? {}
      : {
          options: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            hue: option.hue ?? 'gray',
            archived: false,
          })),
        }),
    isRequired: question.required,
    isRequiredOnSubmit: true,
    isUnique: false,
    isReadOnly: false,
  };
}

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
function safeRedirect(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export interface PublicFormPageProps {
  readonly publicKey: string;
  readonly client: PublicFormClient;
  /** Loads reCAPTCHA for a site key and answers its token getter (`loadCaptcha`). */
  readonly captcha: (siteKey: string) => () => Promise<string | undefined>;
}

/** The hosted form page. */
export function PublicFormPage({ publicKey, client, captcha }: PublicFormPageProps) {
  const [shown, setShown] = useState<Shown>({ kind: 'loading' });
  const [values, setValues] = useState<Readonly<Record<string, unknown>>>({});
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const [isBusy, setBusy] = useState(false);
  // Answers as committed, read at submit (a blur's commit lands just before).
  const answers = useRef<Record<string, unknown>>({});
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

  const send = async () => {
    if (isBusy) return;
    const checked = checkAnswers(form, answers.current, { pattern: browserPattern });
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
            window.location.assign(to);
            setShown({ kind: 'done', title: form.title, message: strings.redirecting });
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
      <div onFocusCapture={touch} onInputCapture={touch}>
        <Form
          submitLabel={form.buttonText}
          busyLabel={words.sending}
          isBusy={isBusy}
          refusals={refusals}
          onSubmit={() => {
            void send();
          }}
          label={form.title}
        >
          {form.steps.flatMap((step) =>
            step.blocks.map((block) => {
              switch (block.kind) {
                case 'heading':
                  return <h2 key={block.id}>{block.text}</h2>;
                case 'text':
                  return <p key={block.id}>{block.text}</p>;
                case 'divider':
                  return <Separator key={block.id} />;
                case 'question': {
                  const error = fieldErrors[block.id];
                  return (
                    <div key={block.id}>
                      <AttributeEditor
                        attribute={attributeOf(block)}
                        value={values[block.id] ?? null}
                        surface="form"
                        onCommit={(value) => {
                          answers.current = { ...answers.current, [block.id]: value };
                          setValues((held) => ({ ...held, [block.id]: value }));
                          if (fieldErrors[block.id] !== undefined) {
                            setFieldErrors(({ [block.id]: _dropped, ...rest }) => rest);
                          }
                        }}
                        {...(error === undefined ? {} : { error })}
                      />
                      {block.help !== undefined && <p>{block.help}</p>}
                    </div>
                  );
                }
              }
            }),
          )}
          {/* The honeypot (AC-584): out of sight and out of the tab order; a person never fills it. */}
          <VisuallyHidden>
            <span aria-hidden="true">
              <input ref={honeypot} name="crm_hp" tabIndex={-1} autoComplete="off" defaultValue="" />
            </span>
          </VisuallyHidden>
        </Form>
      </div>
      {form.recaptchaSiteKey !== undefined && <p>{words.recaptchaNotice}</p>}
    </AuthLayout>
  );
}
