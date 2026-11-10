import {
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  Label,
  Input,
  TextArea as AriaTextArea,
  Text,
  FieldError,
  Form as AriaForm,
  type FormProps as AriaFormProps,
} from 'react-aria-components';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { CircleAlert } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import './Field.css';

/** 36px app field (`md`) or the 44px field of public pages and guest forms, with 16px text so phones never zoom (`lg`). */
export type FieldSize = 'md' | 'lg';

/**
 * Replays transitions.dev's error state shake on the element behind `ref`: 6px right, 6px left,
 * 4px overshoot, rest (80/80/60/60ms). Call `shake()` on an invalid submit or a wrong code.
 */
export function useShake<T extends HTMLElement>(): { readonly ref: RefObject<T | null>; readonly shake: () => void } {
  const ref = useRef<T>(null);
  const shake = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('tf-field-shake');
    void el.offsetWidth;
    el.classList.add('tf-field-shake');
    el.addEventListener('animationend', () => el.classList.remove('tf-field-shake'), { once: true });
  }, []);
  return { ref, shake };
}

/** The label over a field, with an optional quiet word after it ("Optional"). Must sit inside a React Aria field. */
export function FieldLabel({ children, aside, className }: { readonly children: ReactNode; readonly aside?: string; readonly className?: string }) {
  return (
    <Label className={cx('tf-field__label', className)}>
      {children}
      {aside && <span className="tf-field__aside"> {aside}</span>}
    </Label>
  );
}

/** One grey line under a field that helps: the format expected, what the value is for. */
export function FieldDescription({ children }: { readonly children: ReactNode }) {
  return <Text slot="description" className="tf-field__desc">{children}</Text>;
}

/** What is wrong, in danger red with an icon; fades in under the field only while it is invalid. */
export function FieldErrorText({ children }: { readonly children?: ReactNode }) {
  return (
    <FieldError className="tf-field__error">
      {(v) => {
        // Invalid with nothing to say (the form shows its own sentence): draw nothing, not a lone icon.
        const text = children ?? v.validationErrors.join(' ');
        return text === '' || text === undefined || text === null ? null : (
          <>
            <span className="tf-field__error-icon" aria-hidden="true"><CircleAlert size={14} strokeWidth={1.75} /></span>
            <span>{text}</span>
          </>
        );
      }}
    </FieldError>
  );
}

/** The filled box every field draws its input in: grey at rest, white with an accent edge while focused, red when invalid, shaking via `ref`. */
export function FieldBox({ children, className, ref, isInvalid, isDisabled }: { readonly children: ReactNode; readonly className?: string; readonly ref?: RefObject<HTMLDivElement | null>; readonly isInvalid?: boolean; readonly isDisabled?: boolean }) {
  return <div ref={ref} className={cx('tf-field__box', className)} data-invalid={isInvalid || undefined} data-disabled={isDisabled || undefined}>{children}</div>;
}

interface FieldBase extends Omit<AriaTextFieldProps, 'children' | 'className'> {
  /** What the field is. Always give one; hide it visually only where a heading already names the field. */
  readonly label?: string;
  /** A quiet word after the label: "Optional". */
  readonly aside?: string;
  readonly description?: ReactNode;
  /** The sentence shown when invalid. Without it, the browser's own validation message shows. */
  readonly errorMessage?: string;
  readonly placeholder?: string;
  readonly size?: FieldSize;
  readonly className?: string;
}

/** Props for TextField. */
export interface TextFieldProps extends FieldBase {
  /** A Lucide icon at the start of the box (16px). */
  readonly icon?: ReactNode;
  /** Something at the end of the box: a unit, a small button. */
  readonly suffix?: ReactNode;
}

/** A labelled single line text input. Filled grey at rest, white with an accent edge on focus; shakes when submitted invalid. */
export function TextField({ label, aside, description, errorMessage, placeholder, size = 'md', icon, suffix, className, ...rest }: TextFieldProps) {
  const { ref, shake } = useShake<HTMLDivElement>();
  useShakeWhenInvalid(rest.isInvalid, shake);
  return (
    <AriaTextField {...rest} className={cx('tf-field', `tf-field--${size}`, className)}>
      {label && <FieldLabel aside={aside}>{label}</FieldLabel>}
      <div className="tf-field__box" ref={ref}>
        {icon && <span className="tf-field__icon" aria-hidden="true">{icon}</span>}
        <Input className="tf-field__input" placeholder={placeholder} onInvalid={shake} />
        {suffix && <span className="tf-field__suffix">{suffix}</span>}
      </div>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldErrorText>{errorMessage}</FieldErrorText>
    </AriaTextField>
  );
}

/** Props for TextArea. */
export interface TextAreaProps extends FieldBase {
  /** Visible lines before it grows with its text. */
  readonly rows?: number;
  /** Shows "used / maxLength" under the box; turns amber at 90% and red at the limit. Needs `maxLength`. */
  readonly showCount?: boolean;
}

/** A labelled multi line text input that grows with its content, with an optional character count. */
export function TextArea({ label, aside, description, errorMessage, placeholder, size = 'md', rows = 3, showCount = false, className, value, defaultValue, onChange, ...rest }: TextAreaProps) {
  const { ref, shake } = useShake<HTMLDivElement>();
  useShakeWhenInvalid(rest.isInvalid, shake);
  const [own, setOwn] = useState(defaultValue ?? '');
  const text = value ?? own;
  const max = rest.maxLength;
  const ratio = max ? text.length / max : 0;
  return (
    <AriaTextField
      {...rest}
      value={text}
      onChange={(v) => { setOwn(v); onChange?.(v); }}
      className={cx('tf-field', 'tf-field--area', `tf-field--${size}`, className)}
    >
      {label && <FieldLabel aside={aside}>{label}</FieldLabel>}
      <div className="tf-field__box" ref={ref} style={{ '--tf-field-rows': rows } as CSSProperties}>
        <AriaTextArea className="tf-field__input tf-field__textarea" placeholder={placeholder} rows={rows} onInvalid={shake} />
      </div>
      {(description || (showCount && max)) && (
        <div className="tf-field__foot">
          {description ? <FieldDescription>{description}</FieldDescription> : <span />}
          {showCount && max && (
            <span className="tf-field__count" data-near={ratio >= 0.9 || undefined} data-full={ratio >= 1 || undefined} aria-live="polite">
              {text.length.toLocaleString('en-US')}/{max.toLocaleString('en-US')}
            </span>
          )}
        </div>
      )}
      <FieldErrorText>{errorMessage}</FieldErrorText>
    </AriaTextField>
  );
}

/** Shakes when a field turns invalid from outside (a server refusal), not on first render. */
function useShakeWhenInvalid(isInvalid: boolean | undefined, shake: () => void) {
  const was = useRef(isInvalid);
  useEffect(() => {
    if (isInvalid && !was.current) shake();
    was.current = isInvalid;
  }, [isInvalid, shake]);
}

/** Props for Form. */
export interface FormProps extends Omit<AriaFormProps, 'className'> {
  readonly className?: string;
}

/** A form that validates natively on submit: the invalid fields shake, show their message and the first takes focus. Stacks its children 16px apart. */
export function Form({ className, validationBehavior = 'native', ...rest }: FormProps) {
  return <AriaForm {...rest} validationBehavior={validationBehavior} className={cx('tf-form', className)} />;
}

/** Props for FieldGroup. */
export interface FieldGroupProps {
  /** A section title over the fields ("Contact"). */
  readonly title?: string;
  readonly description?: string;
  /** 2 lays fields two to a row while the group is at least 440px wide; text areas always take the full row. */
  readonly columns?: 1 | 2;
  readonly children: ReactNode;
}

/** A titled block of fields inside a Form, stacked or two to a row. */
export function FieldGroup({ title, description, columns = 1, children }: FieldGroupProps) {
  return (
    <fieldset className="tf-fieldgroup">
      {title && <legend className="tf-fieldgroup__title">{title}</legend>}
      {description && <p className="tf-fieldgroup__desc">{description}</p>}
      <div className={cx('tf-fieldgroup__grid', columns === 2 && 'tf-fieldgroup__grid--2')}>{children}</div>
    </fieldset>
  );
}

/** The buttons under a form, right aligned (or full width on a guest page with `isFull`). */
export function FormActions({ children, isFull = false }: { readonly children: ReactNode; readonly isFull?: boolean }) {
  return <div className={cx('tf-form__actions', isFull && 'tf-form__actions--full')}>{children}</div>;
}
