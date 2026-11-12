import { TextField, Input } from 'react-aria-components';
import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { FieldDescription, FieldErrorText, FieldLabel, useShake } from '../Field/Field.tsx';
import { Spinner, SuccessCheck } from '../Motion/Motion.tsx';
import './CodeInput.css';

/** Props for CodeInput. */
export interface CodeInputProps {
  /** What the code is ("Code from your email"). */
  readonly label: string;
  /** How many digits; 6 by default. */
  readonly length?: number;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  /** Called once the last digit is in (typed, pasted or filled by the phone). */
  readonly onComplete?: (code: string) => void;
  /** Checking the code: a spinner shows and the boxes hold still. */
  readonly isPending?: boolean;
  /** The code was wrong: the boxes shake, turn red and empty, and `errorMessage` stays until typing starts again. */
  readonly isInvalid?: boolean;
  /** The code was right: the boxes turn green and a check draws itself. */
  readonly isSuccess?: boolean;
  readonly errorMessage?: string;
  readonly description?: ReactNode;
  readonly isDisabled?: boolean;
  readonly autoFocus?: boolean;
  /** `md` 44px boxes in a dialog, `lg` 48 × 56 on a page whose task is the code; `lg` splits six digits three and three. */
  readonly size?: 'md' | 'lg';
}

const SEPARATORS = /[\s‐-―-]/g;

/** The code inside a pasted text: digits with spaces or dashes ("481 593"), or a sentence's single run of `length` digits. */
function codeFromPaste(text: string, length: number): string | undefined {
  const cleaned = text.replace(SEPARATORS, '');
  if (/^\d+$/.test(cleaned)) return cleaned.slice(0, length);
  const runs = text.match(new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`, 'g')) ?? [];
  return runs.length === 1 ? runs[0] : undefined;
}

/**
 * A one time code as separate boxes over one real input (`autocomplete="one-time-code"`), so typing advances,
 * Backspace goes back, and a paste or the phone's suggestion fills every box at once.
 */
export function CodeInput({ label, length = 6, value, defaultValue, onChange, onComplete, isPending = false, isInvalid = false, isSuccess = false, errorMessage, description, isDisabled = false, autoFocus = false, size = 'md' }: CodeInputProps) {
  const [own, setOwn] = useState(defaultValue ?? '');
  const code = value ?? own;
  const [focused, setFocused] = useState(false);
  const { ref, shake } = useShake<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement>(null);
  const half = size === 'lg' && length % 2 === 0 ? length / 2 : undefined;
  const locked = isPending || isSuccess;

  const set = (next: string) => {
    setOwn(next);
    onChange?.(next);
    if (next.length === length && next !== code) onComplete?.(next);
  };

  // transitions.dev 12: a wrong code shakes the row, then the boxes empty and focus returns to the first one.
  useEffect(() => {
    if (!isInvalid) return;
    shake();
    const el = ref.current;
    const ms = el ? parseFloat(getComputedStyle(el).getPropertyValue('--duration-micro')) * 3.5 || 280 : 280;
    const t = window.setTimeout(() => { setOwn(''); onChange?.(''); inputRef.current?.focus(); }, ms + 120);
    return () => window.clearTimeout(t);
    // Runs on each new refusal only.
  }, [isInvalid]);

  const keepCaretAtEnd = () => {
    const el = inputRef.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = codeFromPaste(e.clipboardData.getData('text'), length);
    if (pasted === undefined) return;
    e.preventDefault();
    set(pasted);
  };

  return (
    <TextField
      className={cx('tf-codeinput', `tf-codeinput--${size}`)}
      value={code}
      onChange={(next) => set(next.replace(SEPARATORS, '').replace(/\D/g, '').slice(0, length))}
      inputMode="numeric"
      autoComplete="one-time-code"
      isDisabled={isDisabled}
      isReadOnly={locked}
      isInvalid={isInvalid}
      autoFocus={autoFocus}
    >
      <FieldLabel>{label}</FieldLabel>
      <div className="tf-codeinput__row">
        <div className="tf-codeinput__boxes" ref={ref} data-focused={(focused && !locked) || undefined} data-success={isSuccess || undefined}>
          <Input
            ref={inputRef}
            className="tf-codeinput__input"
            data-1p-ignore
            data-lpignore="true"
            onPaste={onPaste}
            onFocus={() => { setFocused(true); keepCaretAtEnd(); }}
            onBlur={() => setFocused(false)}
            onSelect={keepCaretAtEnd}
          />
          {Array.from({ length }, (_, i) => {
            const ch = code[i] ?? '';
            return (
              <span key={i} className="tf-codeinput__box" aria-hidden="true" data-filled={ch ? '' : undefined} data-next={i === Math.min(code.length, length - 1) ? '' : undefined} data-half={i === half || undefined}>
                {ch ? <span key={`${i}-${ch}`} className="tf-codeinput__digit">{ch}</span> : <span className="tf-codeinput__caret" />}
              </span>
            );
          })}
        </div>
        <span className="tf-codeinput__status" aria-live="polite">
          {isPending && <Spinner size={18} label="Checking the code" />}
          {isSuccess && <span className="tf-codeinput__ok"><SuccessCheck size={20} /><span className="tf-sr-only">Code accepted</span></span>}
        </span>
      </div>
      {description && !isInvalid && <FieldDescription>{description}</FieldDescription>}
      <FieldErrorText>{errorMessage}</FieldErrorText>
    </TextField>
  );
}
