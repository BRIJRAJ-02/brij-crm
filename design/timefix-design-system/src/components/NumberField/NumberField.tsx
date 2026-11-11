import { NumberField as AriaNumberField, type NumberFieldProps as AriaNumberFieldProps, Input, Button } from 'react-aria-components';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { FieldBox, FieldDescription, FieldErrorText, FieldLabel, useShake, type FieldSize } from '../Field/Field.tsx';
import './NumberField.css';

/** `number` plain, `currency` money with its symbol in front and two decimals, `percent` 0–100 with a % after. */
export type NumberMode = 'number' | 'currency' | 'percent';

/** Props for NumberField. */
export interface NumberFieldProps extends Omit<AriaNumberFieldProps, 'children' | 'className' | 'formatOptions'> {
  readonly label?: string;
  readonly aside?: string;
  readonly description?: ReactNode;
  readonly errorMessage?: string;
  readonly placeholder?: string;
  readonly mode?: NumberMode;
  /** ISO 4217 code for `currency` ("USD", "EUR", "INR"). */
  readonly currency?: string;
  /** Overrides the format; `mode` picks a sensible one. */
  readonly formatOptions?: Intl.NumberFormatOptions;
  /** A unit after the value ("min", "seats"). */
  readonly unit?: string;
  /** Minus and plus buttons at the end of the box. On by default. */
  readonly showSteppers?: boolean;
  readonly size?: FieldSize;
  readonly className?: string;
}

/** The currency's narrow symbol ("$", "€", "₹"). */
export function currencySymbol(currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
}

/** A number typed or stepped: arrows and the minus/plus buttons step it, money gets its symbol, and each new value pops in digit by digit. */
export function NumberField({ label, aside, description, errorMessage, placeholder, mode = 'number', currency = 'USD', formatOptions, unit, showSteppers = true, size = 'md', className, value, defaultValue, onChange, ...rest }: NumberFieldProps) {
  const [own, setOwn] = useState<number>(defaultValue ?? Number.NaN);
  const current = value ?? own;
  const fmt = formatOptions ?? (mode === 'currency' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : mode === 'percent' ? { maximumFractionDigits: 1 } : { maximumFractionDigits: 2 });
  const prefix = mode === 'currency' ? currencySymbol(currency) : undefined;
  const suffix = mode === 'percent' ? '%' : unit;
  const { ref, shake } = useShake<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement>(null);
  const prevText = useRef<string | undefined>(undefined);
  const [pop, setPop] = useState<{ readonly text: string; readonly same: number; readonly n: number } | undefined>();

  // transitions.dev 02 number pop-in: once the value commits, the digits that changed rise 8px out of (500ms,
  // bounce); the leading digits the old and new share stay still, and the last two follow 70ms apart.
  useLayoutEffect(() => {
    const text = inputRef.current?.value ?? '';
    const prev = prevText.current;
    prevText.current = text;
    if (prev === undefined || prev === text || text === '' || prev === '') return;
    let same = 0;
    while (same < prev.length && same < text.length && prev[same] === text[same]) same++;
    setPop((p) => ({ text, same, n: (p?.n ?? 0) + 1 }));
  }, [current]);

  useEffect(() => {
    const el = inputRef.current;
    if (!pop || !el) return;
    const ms = (name: string) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(() => setPop(undefined), reduce ? 0 : ms('--duration-very-slow') + 2 * ms('--duration-micro') + 20);
    return () => window.clearTimeout(t);
  }, [pop]);

  return (
    <AriaNumberField
      {...rest}
      value={current}
      onChange={(v) => { setOwn(v); onChange?.(v); }}
      formatOptions={fmt}
      className={cx('tf-field', 'tf-num', `tf-field--${size}`, className)}
    >
      {label && <FieldLabel aside={aside}>{label}</FieldLabel>}
      <FieldBox ref={ref} className="tf-num__box">
        {prefix && <span className="tf-num__affix" aria-hidden="true">{prefix}</span>}
        <span className="tf-num__slot">
          <Input ref={inputRef} className="tf-field__input tf-num__input" placeholder={placeholder} onInvalid={shake} data-popping={pop ? '' : undefined} />
          {pop && (
            <span key={pop.n} className="tf-num__pop" aria-hidden="true">
              {[...pop.text].map((ch, i, all) => (
                <span key={i} className="tf-num__digit" data-same={i < pop.same || undefined} data-stagger={i === all.length - 2 ? 1 : i === all.length - 1 ? 2 : undefined}>{ch}</span>
              ))}
            </span>
          )}
        </span>
        {suffix && <span className="tf-num__affix" aria-hidden="true">{suffix}</span>}
        {showSteppers && (
          <span className="tf-num__steps">
            <Button slot="decrement" className="tf-num__step"><Minus size={14} strokeWidth={1.75} /></Button>
            <Button slot="increment" className="tf-num__step"><Plus size={14} strokeWidth={1.75} /></Button>
          </span>
        )}
      </FieldBox>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldErrorText>{errorMessage}</FieldErrorText>
    </AriaNumberField>
  );
}
