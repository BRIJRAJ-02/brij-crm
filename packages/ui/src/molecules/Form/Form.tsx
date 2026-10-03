import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { Form as AriaForm } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Callout } from '../Callout/Callout.tsx';
import styles from './Form.module.css';

/** What a Form submits: each named field's text, by its `name`. */
export type FormValues = Readonly<Record<string, string>>;

/**
 * A refusal from the server: a stable `code`, a plain `message` that says what
 * to do, and the attribute it is about, when it is about one.
 */
export interface FormRefusal {
  readonly code: string;
  readonly message: string;
  readonly attributeId?: string;
}

/** What every Form takes. `R` is the refusal shape the screen has, at least a `FormRefusal`. */
interface FormBase<R extends FormRefusal> {
  /** The fields, each with a `name`, stacked `space-16` apart. */
  readonly children: ReactNode;
  /** Called on Enter in a field or a press of the submit button, with each named field's text. Not called while busy or disabled. */
  readonly onSubmit: (values: FormValues) => void;
  /** Waiting for the server: the submit button spins, and submitting again does nothing. */
  readonly isBusy?: boolean;
  /** The form can't be sent: the submit button is off. Disable the fields themselves too. */
  readonly isDisabled?: boolean;
  /**
   * The last answer's refusals. Each one `fieldFor` maps to a field in the
   * form shows on that field until its value changes (as it is typed, or
   * when the screen fills it), and stays gone for that answer even if the
   * value changes back; the rest (about no
   * field, or about a name no field in the form has) show above the fields.
   * They are hidden while busy, and each submit is a new answer, so the same
   * refusal again shows again.
   */
  readonly refusals?: readonly R[];
  /** The `name` of the field a refusal is about (often from its `attributeId`), or undefined to show it above the fields. */
  readonly fieldFor?: (refusal: R) => string | undefined;
  /** Names the form for screen readers when no heading near it does. */
  readonly label?: string;
}

/** The submit under the fields, filling the width, as on a sign in page. */
interface OwnSubmit {
  /** The submit button's label, a verb ("Create workspace"). */
  readonly submitLabel: string;
  /** The submit button's label while busy, the ongoing verb ("Creating workspace"). Defaults to `submitLabel`. */
  readonly busyLabel?: string;
  /** Other ways to go on, under the submit (Continue with Google): Buttons with `size="lg"` and `isFullWidth="center"`. */
  readonly actions?: ReactNode;
  /** The ids, space separated, of lines that describe the submit button, such as why it is off. */
  readonly submitDescribedBy?: string;
  /** The form's `id`. */
  readonly id?: string;
}

/** The submit outside the form, in a Modal's `actions`: a Button with `type="submit"` whose `form` is this `id`. */
interface OutsideSubmit {
  /** The form's `id`, which the outside submit Button names in its `form`. */
  readonly id: string;
  readonly submitLabel?: never;
  readonly busyLabel?: never;
  readonly actions?: never;
  readonly submitDescribedBy?: never;
}

/**
 * Props for Form. `R` is the refusal shape the screen has, at least a
 * `FormRefusal`. With `submitLabel` the submit sits under the fields; without
 * it, the form has an `id` and its submit lives outside it (a Modal's footer).
 */
export type FormProps<R extends FormRefusal = FormRefusal> = FormBase<R> & (OwnSubmit | OutsideSubmit);

/** Refusal messages by field name, in the shape React Aria's Form reads. */
type FieldRefusals = Readonly<Record<string, string[]>>;

/** No names: none dropped yet. One shared empty set, so a memo over it holds. */
const NONE: ReadonlySet<string> = new Set();

/**
 * Splits refusals into messages by field name, and the messages about no
 * field. A name no field in the form has goes to the banner too, so its
 * message never vanishes. Until the form's fields are known (`names`
 * undefined, before the first layout), every mapped name is trusted.
 */
function splitRefusals<R extends FormRefusal>(
  refusals: readonly R[],
  fieldFor: ((refusal: R) => string | undefined) | undefined,
  names: ReadonlySet<string> | undefined,
): { readonly byField: FieldRefusals; readonly banner: readonly string[] } {
  return refusals.reduce<{ readonly byField: FieldRefusals; readonly banner: readonly string[] }>(
    ({ byField, banner }, refusal) => {
      const field = fieldFor?.(refusal);
      return field === undefined || (names !== undefined && !names.has(field))
        ? { byField, banner: [...banner, refusal.message] }
        : { byField: { ...byField, [field]: [...(byField[field] ?? []), refusal.message] }, banner };
    },
    { byField: {}, banner: [] },
  );
}

/** The names of the form's fields, including any outside it that name it with `form`. */
function namesIn(form: HTMLFormElement): ReadonlySet<string> {
  return new Set(
    [...form.elements].flatMap((element) => {
      const name = element.getAttribute('name');
      return name === null || name === '' ? [] : [name];
    }),
  );
}

/** Whether two sets of names hold the same names. */
function sameNames(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((name) => b.has(name));
}

/** Each named field's text from a submitted form. Files and other non text values are left out. */
function valuesOf(form: HTMLFormElement): FormValues {
  return Object.fromEntries(
    [...new FormData(form).entries()].flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : [])),
  );
}

/** The refused names whose value now differs from the value that was refused. */
function changedSince(refused: FormValues, now: FormValues, names: Iterable<string>): readonly string[] {
  return [...names].filter((name) => now[name] !== refused[name]);
}

/** The refusals left once the dropped fields' are taken out; the same object when none are. */
function withoutDropped(errors: FieldRefusals, dropped: ReadonlySet<string>): FieldRefusals {
  if (![...dropped].some((name) => name in errors)) return errors;
  return Object.fromEntries(Object.entries(errors).filter(([name]) => !dropped.has(name)));
}

/** Whether an edited element is one of the form's fields: inside it, or outside it and naming it with `form`. */
function isFieldOf(form: HTMLFormElement, target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  return form.contains(target) || ('form' in target && target.form === form);
}

/**
 * A form that maps the server's refusals to its fields. Built on React Aria's
 * Form: Enter in a field submits, a refusal `fieldFor` maps shows on the Field
 * with that `name` (and clears as soon as its value changes, on input, so the
 * form never shifts under a press of its submit, and stays cleared for that
 * answer), and any other,
 * including one mapped to a name no field has, shows above the fields as a
 * danger Callout, which is announced. When field refusals arrive, focus moves
 * to the first refused field; if it is there already, the refusal is
 * announced. While busy, the submit button spins and a second submit is
 * ignored. The submit fills the width under the fields or, without a
 * `submitLabel`, lives outside the form (a Modal's footer) and names its `id`.
 */
export function Form<R extends FormRefusal = FormRefusal>({
  children,
  onSubmit,
  submitLabel,
  busyLabel,
  isBusy = false,
  isDisabled = false,
  refusals = [],
  fieldFor,
  actions,
  submitDescribedBy,
  id,
  label,
}: FormProps<R>) {
  const formRef = useRef<HTMLFormElement>(null);
  const spokenRef = useRef<HTMLSpanElement>(null);
  const [attempt, setAttempt] = useState(0);
  // The names of the form's fields, read before paint whenever the fields
  // (children) change, so a refusal mapped to a name no field has shows in
  // the banner instead.
  const [names, setNames] = useState<ReadonlySet<string> | undefined>(undefined);
  useLayoutEffect(() => {
    const form = formRef.current;
    if (form === null) return;
    const found = namesIn(form);
    setNames((known) => (known !== undefined && sameNames(known, found) ? known : found));
  }, [children]);
  const { byField, banner } = splitRefusals(isBusy ? [] : refusals, fieldFor, names);
  // React Aria shows a field's refusal again whenever it gets a new object, so
  // refusals rebuilt on every render would bring back one the person already
  // changed. Kept by content and submit, a new object means a new answer.
  const errorsKey = JSON.stringify([attempt, byField]);
  const [kept, setKept] = useState({ key: errorsKey, errors: byField });
  if (kept.key !== errorsKey) setKept({ key: errorsKey, errors: byField });

  // A refusal is about the value that was sent. As soon as a field's value
  // differs from it (typed, or filled in by the screen), its refusal goes, at
  // once rather than on blur: a refusal leaving on blur shifted the form
  // under the pointer, so a press of the submit that blurred the field missed.
  // A dropped refusal stays dropped for that answer, so editing back to the
  // refused value doesn't bring it back; only the next answer can.
  const submitted = useRef<FormValues | undefined>(undefined);
  const [refused, setRefused] = useState<{ readonly key: string; readonly values: FormValues } | undefined>(undefined);
  const [dropped, setDropped] = useState<{ readonly key: string; readonly names: ReadonlySet<string> }>({
    key: kept.key,
    names: new Set(),
  });
  const droppedNow = dropped.key === kept.key ? dropped.names : NONE;
  useLayoutEffect(() => {
    const form = formRef.current;
    if (form === null || refused?.key === kept.key) return;
    // The values these refusals are about: the ones sent, or (refusals given
    // without a submit) the ones on show now.
    setRefused({ key: kept.key, values: submitted.current ?? valuesOf(form) });
  }, [kept.key, refused?.key]);
  // Values are read only while a field still shows a refusal of this answer:
  // a form with nothing to drop does no work per keystroke or render.
  const isWatching = Object.keys(kept.errors).some((name) => !droppedNow.has(name));
  // Reads the fields and drops the refusal of each that changed. In a ref, so
  // the listeners below, added once per watch, always read this render's answer.
  const readCurrent = useRef(() => {});
  useLayoutEffect(() => {
    readCurrent.current = () => {
      const form = formRef.current;
      if (form === null || refused?.key !== kept.key) return;
      const changed = changedSince(refused.values, valuesOf(form), Object.keys(kept.errors));
      if (changed.every((name) => droppedNow.has(name))) return;
      setDropped({ key: kept.key, names: new Set([...droppedNow, ...changed]) });
    };
  });
  // A screen that fills a field itself (one name following another)
  // re-renders the form, which reads the values again.
  useLayoutEffect(() => {
    if (isWatching) readCurrent.current();
  });
  // Every keystroke (the input event) and every committed change. On the
  // document, so React has handled the event first: a re-render flushed
  // before React reads a controlled field's new value (a listener on the form
  // runs earlier) would put the old value back. React's own onInput on the
  // form would avoid that too, but it reaches only fields inside the form's
  // React tree, never one outside it that names the form with `form`, which
  // FormData does send.
  useEffect(() => {
    const form = formRef.current;
    if (form === null || !isWatching) return;
    const doc = form.ownerDocument;
    const onEdit = (event: Event) => {
      if (isFieldOf(form, event.target)) readCurrent.current();
    };
    doc.addEventListener('input', onEdit);
    doc.addEventListener('change', onEdit);
    return () => {
      doc.removeEventListener('input', onEdit);
      doc.removeEventListener('change', onEdit);
    };
  }, [isWatching]);
  const errors = useMemo(() => withoutDropped(kept.errors, droppedNow), [kept.errors, droppedNow]);

  // A new answer (another submit, or a refusal on a field that had none)
  // moves focus or speaks; a refusal leaving, or the screen dropping one,
  // never pulls focus away from the field being typed in.
  const answered = useRef<{ attempt: number; names: ReadonlySet<string> }>({ attempt: -1, names: new Set() });
  useEffect(() => {
    const form = formRef.current;
    const spoken = spokenRef.current;
    if (form === null || spoken === null) return;
    const names = new Set(Object.keys(kept.errors));
    const last = answered.current;
    const isNew = attempt !== last.attempt || [...names].some((name) => !last.names.has(name));
    answered.current = { attempt, names };
    if (!isNew) return;
    const messages = Object.values(kept.errors).flat();
    spoken.textContent = '';
    if (messages.length === 0) return;
    // Focus goes to the first refused field, whose description reads the
    // refusal. Already there (Enter in the field), the refusal is announced.
    const first = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (first !== null && first !== document.activeElement) first.focus();
    else spoken.textContent = messages.join(' ');
  }, [kept.errors, attempt]);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || isDisabled) return;
    const values = valuesOf(event.currentTarget);
    submitted.current = values;
    setAttempt((count) => count + 1);
    onSubmit(values);
  };

  return (
    <AriaForm
      ref={formRef}
      className={styles.root}
      validationBehavior="aria"
      validationErrors={errors}
      onSubmit={submit}
      aria-busy={isBusy || undefined}
      {...(id === undefined ? {} : { id })}
      {...(label === undefined ? {} : { 'aria-label': label })}
    >
      {banner.length > 0 && (
        // A new alert for each submit, so the same refusal again is announced again.
        <Callout key={attempt} tone="danger">
          {banner.join(' ')}
        </Callout>
      )}
      {children}
      {submitLabel !== undefined && (
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            isFullWidth="center"
            isPending={isBusy}
            isDisabled={isDisabled}
            {...(submitDescribedBy === undefined ? {} : { 'aria-describedby': submitDescribedBy })}
          >
            {isBusy ? (busyLabel ?? submitLabel) : submitLabel}
          </Button>
          {actions}
        </div>
      )}
      <VisuallyHidden>
        <span ref={spokenRef} role="status" />
      </VisuallyHidden>
    </AriaForm>
  );
}
