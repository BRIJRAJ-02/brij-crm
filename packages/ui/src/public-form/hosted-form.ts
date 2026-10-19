// The hosted form's renderer (spec 0023, 0023-experience.md, The visitor):
// plain DOM with no React, so the public page stays far under its 40 kB
// budget, and the builder's preview draws the very same markup, inert. Every
// word comes from `formStrings`, every check from `checkAnswers`, so the
// visitor sees what the server would say. The caller sends the answers
// (`onSubmit`); the renderer never touches the network.
import {
  checkAnswers,
  DIAL_CODES,
  formStrings,
  HONEYPOT_KEY,
  toE164,
  type FormStrings,
  type PublicForm,
  type PublicQuestion,
  type SubmitNext,
} from '@crm/contracts/forms';
import styles from './HostedForm.module.css';

/** Where the form is drawn: alone on its page, inside a site's iframe, or as the builder's inert preview. */
export type HostedFormMode = 'page' | 'embed' | 'preview';

/** What a visitor sent: answers by question key, the trap field, and how long they took. */
export interface HostedSubmission {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly trap: string;
  readonly fillMs: number;
  /** Counts up with each "Send another": one idempotency key per round, so a retry sends the same one. */
  readonly round: number;
}

/** What sending answered, as the page's client words it. */
export type HostedSubmitOutcome =
  | { readonly kind: 'done'; readonly next: SubmitNext }
  | { readonly kind: 'invalid'; readonly fields: Readonly<Record<string, string>> }
  | { readonly kind: 'closed' }
  | { readonly kind: 'limited' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'offline' };

/** How a hosted form is drawn and where its answers go. */
export interface HostedFormOptions {
  readonly mode: HostedFormMode;
  /** The country picked first for phone and country questions (ISO alpha 2), guessed by the page. */
  readonly countryGuess?: string;
  /** Sends the answers. Without it the answers are checked and the thank you shows, but nothing is sent. */
  readonly onSubmit?: (submission: HostedSubmission) => Promise<HostedSubmitOutcome>;
  /** Goes to the form's web address after a submission, when it sends visitors on. */
  readonly onRedirect?: (url: string) => void;
  /** The clock, for the fill time (tests pass their own). */
  readonly now?: () => number;
}

/** A drawn form: `update` draws a changed form in place (the builder's preview), `destroy` removes it. */
export interface HostedFormHandle {
  update(form: PublicForm): void;
  destroy(): void;
}

type Attributes = Readonly<Record<string, string | boolean | undefined>>;

/** One element, with its attributes (`class` as the class name, `true` as an empty attribute) and children. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

/** A class from the module, or the empty string. */
const cls = (name: string): string => styles[name] ?? '';

/** One question as drawn: its node, what it answers, and its error line. */
interface DrawnQuestion {
  readonly question: PublicQuestion;
  readonly node: HTMLElement;
  read(): unknown;
  setError(message: string | undefined): void;
  focus(): void;
}

/** A country's flag, from its two regional indicator letters. */
function flagOf(code: string): string {
  const upper = code.toUpperCase();
  return String.fromCodePoint(0x1f1e6 + upper.charCodeAt(0) - 65, 0x1f1e6 + upper.charCodeAt(1) - 65);
}

/** Countries by code with their names in the form's language, sorted by name. */
function countriesIn(language: string): readonly { readonly code: string; readonly name: string }[] {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([language], { type: 'region' });
  } catch {
    names = undefined;
  }
  return [...DIAL_CODES.keys()]
    .map((code) => ({ code, name: names?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, language));
}

/** Draws one question with its label, control and error line. */
function drawQuestion(
  question: PublicQuestion,
  context: {
    readonly prefix: string;
    readonly words: FormStrings;
    readonly language: string;
    readonly countryGuess: string | undefined;
    readonly onInput: () => void;
  },
): DrawnQuestion {
  const { words } = context;
  const id = `${context.prefix}-${question.key}`;
  const errorId = `${id}-error`;
  const error = h('p', { class: cls('error'), id: errorId });
  const noMarker = question.required || question.answerType === 'checkbox' || question.answerType === 'yes_no';
  // A question with no label yet (only in the builder's preview) reads "Untitled question", muted.
  const named = (): Node | string =>
    question.label.trim() === '' ? h('span', { class: cls('untitled') }, [words.untitledQuestion]) : question.label;
  const labelText = (): (Node | string)[] =>
    noMarker ? [named()] : [named(), ' ', h('span', { class: cls('optional') }, [words.optional])];
  const describe = { 'aria-describedby': errorId };
  const listen = (control: HTMLElement) => {
    control.addEventListener('input', context.onInput);
    control.addEventListener('change', context.onInput);
  };
  const invalidOn =
    (controls: readonly HTMLElement[]) =>
    (message: string | undefined): void => {
      error.textContent = message ?? '';
      for (const control of controls) {
        if (message === undefined) control.removeAttribute('aria-invalid');
        else control.setAttribute('aria-invalid', 'true');
      }
    };
  const field = (control: (Node | string)[], asGroup = false): HTMLElement =>
    asGroup
      ? h('fieldset', { class: cls('field'), 'aria-describedby': errorId }, [
          h('legend', { class: cls('label') }, labelText()),
          ...control,
          error,
        ])
      : h('div', { class: cls('field') }, [
          h('label', { class: cls('label'), for: id }, labelText()),
          ...control,
          error,
        ]);

  const placeholder = question.placeholder;
  switch (question.answerType) {
    case 'long_text': {
      const input = h('textarea', {
        class: `${cls('input')} ${cls('area')}`,
        id,
        name: question.key,
        placeholder,
        rows: '3',
        ...describe,
      });
      listen(input);
      return {
        question,
        node: field([input]),
        read: () => input.value,
        setError: invalidOn([input]),
        focus: () => input.focus(),
      };
    }
    case 'dropdown':
    case 'country': {
      const blank = question.required ? words.chooseOne : words.preferNot;
      const options =
        question.answerType === 'country'
          ? countriesIn(context.language).map((country) =>
              h('option', { value: country.name, selected: country.code === context.countryGuess }, [country.name]),
            )
          : (question.choices ?? []).map((choice) => h('option', { value: choice }, [choice]));
      const select = h('select', { class: cls('input'), id, name: question.key, ...describe }, [
        h('option', { value: '' }, [blank]),
        ...options,
      ]);
      listen(select);
      return {
        question,
        node: field([select]),
        read: () => select.value,
        setError: invalidOn([select]),
        focus: () => select.focus(),
      };
    }
    case 'choice': {
      const radios = (question.choices ?? []).map((choice, index) =>
        h('input', { class: cls('tick'), type: 'radio', name: question.key, value: choice, id: `${id}-${index}` }),
      );
      for (const radio of radios) listen(radio);
      const list = h(
        'div',
        { class: cls('choices') },
        radios.map((radio, index) =>
          h('label', { class: cls('choice'), for: radio.id }, [radio, question.choices?.[index] ?? '']),
        ),
      );
      return {
        question,
        node: field([list], true),
        read: () => radios.find((radio) => radio.checked)?.value,
        setError: invalidOn(radios),
        focus: () => (radios.find((radio) => radio.checked) ?? radios[0])?.focus(),
      };
    }
    case 'checkbox':
    case 'yes_no': {
      const box = h('input', {
        class: cls('tick'),
        type: 'checkbox',
        id,
        name: question.key,
        role: question.answerType === 'yes_no' ? 'switch' : undefined,
        ...describe,
      });
      listen(box);
      const node = h('div', { class: cls('field') }, [
        h('label', { class: cls('choice'), for: id }, [box, h('span', { class: cls('label') }, [named()])]),
        error,
      ]);
      return { question, node, read: () => box.checked, setError: invalidOn([box]), focus: () => box.focus() };
    }
    case 'phone': {
      // Closed, the picker shows the flag and code ("🇺🇸 +1"); its list and its name carry the country.
      const countries = countriesIn(context.language);
      const named = new Map(countries.map((country) => [country.code, country.name]));
      const full = (code: string) => `${flagOf(code)} ${named.get(code) ?? code} +${DIAL_CODES.get(code) ?? ''}`;
      const short = (code: string) => `${flagOf(code)} +${DIAL_CODES.get(code) ?? ''}`;
      const codes = countries.map((country) =>
        h('option', { value: country.code, selected: country.code === context.countryGuess }, [full(country.code)]),
      );
      const dial = h('select', { class: `${cls('input')} ${cls('dial')}`, name: `${question.key}_country` }, codes);
      if (context.countryGuess === undefined || !DIAL_CODES.has(context.countryGuess)) dial.value = 'US';
      let shortened: HTMLOptionElement | undefined;
      const compact = () => {
        if (shortened !== undefined) shortened.textContent = full(shortened.value);
        shortened = dial.selectedOptions[0];
        if (shortened !== undefined) shortened.textContent = short(shortened.value);
        dial.setAttribute('aria-label', words.dialCodeOf(named.get(dial.value) ?? dial.value));
      };
      const expand = () => {
        if (shortened !== undefined) shortened.textContent = full(shortened.value);
        shortened = undefined;
      };
      compact();
      dial.addEventListener('mousedown', expand);
      dial.addEventListener('change', compact);
      dial.addEventListener('blur', compact);
      const input = h('input', {
        class: cls('input'),
        id,
        name: question.key,
        type: 'tel',
        inputmode: 'tel',
        autocomplete: 'tel-national',
        placeholder,
        ...describe,
      });
      listen(dial);
      listen(input);
      return {
        question,
        node: field([h('div', { class: cls('phone') }, [dial, input])]),
        read: () =>
          input.value.trim() === '' ? undefined : { number: toE164(dial.value, input.value), country: dial.value },
        setError: invalidOn([input]),
        focus: () => input.focus(),
      };
    }
    default: {
      const kind = question.answerType;
      const input = h('input', {
        class: cls('input'),
        id,
        name: question.key,
        type: kind === 'email' ? 'email' : kind === 'website' ? 'url' : 'text',
        inputmode: kind === 'number' ? 'decimal' : kind === 'website' ? 'url' : undefined,
        autocomplete: kind === 'email' ? 'email' : kind === 'website' ? 'url' : undefined,
        spellcheck: kind === 'email' || kind === 'website' ? 'false' : undefined,
        disabled: kind === 'file',
        placeholder: kind === 'file' ? words.fileLater : placeholder,
        ...describe,
      });
      listen(input);
      return {
        question,
        node: field([input]),
        read: () => (kind === 'file' ? undefined : input.value),
        setError: invalidOn([input]),
        focus: () => input.focus(),
      };
    }
  }
}

/** The headline's element: a page's own h1, a heading of the site's page inside an embed. */
const headingTag = (mode: HostedFormMode) => (mode === 'page' ? 'h1' : 'h2');

/** The frame every view of a form draws in, with its look. */
function frame(mode: HostedFormMode, look: PublicForm['look'] | undefined): HTMLElement {
  return h('div', {
    class: cls('root'),
    'data-theme': look?.colour,
    'data-corners': look?.corners,
    'data-page': mode === 'page',
  });
}

/** A page with no form to draw: an address that names none, or a load that failed. */
export type FormMessageKind = 'missing' | 'failed';

/**
 * Draws a message in the form's place: a plain not found page with no
 * workspace details, or a load that failed. Answers the page title to use.
 */
export function mountFormMessage(
  root: HTMLElement,
  message: { readonly mode: HostedFormMode; readonly kind: FormMessageKind },
): HostedFormHandle & { readonly title: string } {
  const words = formStrings('en');
  const node = frame(message.mode, undefined);
  const title = message.kind === 'missing' ? words.notFoundTitle : words.failed;
  node.append(h(headingTag(message.mode), { class: cls('headline') }, [title]));
  if (message.kind === 'missing') node.append(h('p', { class: cls('subheading') }, [words.notFound]));
  root.append(node);
  return { title, update: () => undefined, destroy: () => node.remove() };
}

/**
 * Draws `form` into `root`: the headline, the sub heading, every question in
 * order and the button, with the answer check on submit and then on each
 * change while an error shows, the first error focused, "Sending…" while it
 * sends, and the thank you in place with focus on its heading. A paused form
 * draws its closed message. In the preview everything is inert: nothing
 * focuses, nothing submits, and a visually hidden note says what it is.
 */
export function mountHostedForm(root: HTMLElement, initial: PublicForm, options: HostedFormOptions): HostedFormHandle {
  const now = options.now ?? (() => Date.now());
  const preview = options.mode === 'preview';
  const prefix = `hf-${initial.key}${preview ? '-preview' : ''}`;
  const container = h('div');
  root.append(container);
  let form = initial;
  let round = 0;
  let startedAt = now();

  const draw = (view: HTMLElement) => {
    container.replaceChildren(
      ...(preview ? [h('p', { class: cls('hidden') }, [formStrings(form.language).previewNote])] : []),
      view,
    );
    if (preview) view.inert = true;
  };

  const drawThanks = (next: Extract<SubmitNext, { kind: 'message' }>) => {
    const words = formStrings(form.language);
    const node = frame(options.mode, form.look);
    const heading = h(headingTag(options.mode), { class: cls('headline'), tabindex: '-1' }, [words.thanksTitle]);
    const again = h('button', { class: cls('quiet'), type: 'button' }, [words.sendAnother]);
    again.addEventListener('click', () => {
      round += 1;
      drawForm();
    });
    node.append(
      heading,
      h('div', { class: cls('form') }, [
        h('p', { class: cls('text') }, [next.text === '' ? words.thanks : next.text]),
        again,
      ]),
    );
    draw(node);
    heading.focus();
  };

  const drawForm = () => {
    const words = formStrings(form.language);
    startedAt = now();
    if (form.status === 'paused') {
      const node = frame(options.mode, form.look);
      node.append(h(headingTag(options.mode), { class: cls('headline') }, [words.closed]));
      draw(node);
      return;
    }
    let checking = false;
    let sending = false;
    const drawn: DrawnQuestion[] = [];
    const recheck = () => {
      if (!checking) return;
      const result = checkAnswers(form, answersOf());
      const fields = result.ok ? {} : result.fields;
      for (const item of drawn) item.setError(fields[item.question.key]);
    };
    for (const question of form.questions) {
      drawn.push(
        drawQuestion(question, {
          prefix,
          words,
          language: form.language,
          countryGuess: options.countryGuess,
          onInput: recheck,
        }),
      );
    }
    const answersOf = (): Record<string, unknown> =>
      Object.fromEntries(drawn.map((item) => [item.question.key, item.read()]));
    const trap = h('input', {
      type: 'text',
      name: HONEYPOT_KEY,
      tabindex: '-1',
      autocomplete: 'off',
      id: `${prefix}-${HONEYPOT_KEY}`,
    });
    const alert = h('p', { class: cls('alert'), role: 'alert' });
    const button = h('button', { class: cls('button'), type: preview ? 'button' : 'submit' }, [form.buttonText]);
    const showErrors = (fields: Readonly<Record<string, string>>) => {
      checking = true;
      for (const item of drawn) item.setError(fields[item.question.key]);
      drawn.find((item) => fields[item.question.key] !== undefined)?.focus();
    };
    const body = h('form', { class: cls('form'), novalidate: true }, [
      ...drawn.map((item) => item.node),
      h('div', { class: cls('trap'), 'aria-hidden': 'true' }, [h('label', { for: trap.id }, [words.honeypot]), trap]),
      alert,
      button,
      ...(form.recaptchaSiteKey === undefined ? [] : [h('p', { class: cls('notice') }, [words.recaptchaNotice])]),
    ]);
    body.addEventListener('submit', (event) => {
      event.preventDefault();
      if (preview || sending) return;
      alert.textContent = '';
      const answers = answersOf();
      const result = checkAnswers(form, answers);
      if (!result.ok) {
        showErrors(result.fields);
        return;
      }
      // A page with nowhere to send (a draft opened as a preview) checks the answers, then thanks.
      if (options.onSubmit === undefined) {
        drawThanks({ kind: 'message', text: form.thanks ?? '' });
        return;
      }
      sending = true;
      button.disabled = true;
      button.textContent = words.sending;
      const done = () => {
        sending = false;
        button.disabled = false;
        button.textContent = form.buttonText;
      };
      void options
        .onSubmit({ answers, trap: trap.value, fillMs: Math.max(0, now() - startedAt), round })
        .then((outcome) => {
          done();
          switch (outcome.kind) {
            case 'done':
              if (outcome.next.kind === 'redirect') options.onRedirect?.(outcome.next.url);
              else drawThanks(outcome.next);
              return;
            case 'invalid':
              showErrors(outcome.fields);
              return;
            case 'closed':
              form = { ...form, status: 'paused' };
              drawForm();
              return;
            case 'offline':
              alert.textContent = words.offline;
              return;
            case 'limited':
              alert.textContent = words.tooMany;
              return;
            case 'failed':
              alert.textContent = words.failed;
              return;
          }
        });
    });
    const node = frame(options.mode, form.look);
    node.append(
      h(headingTag(options.mode), { class: cls('headline') }, [form.headline]),
      ...(form.subheading === undefined ? [] : [h('p', { class: cls('subheading') }, [form.subheading])]),
      body,
    );
    draw(node);
  };

  drawForm();
  return {
    update(next) {
      form = next;
      drawForm();
    },
    destroy() {
      container.remove();
    },
  };
}
