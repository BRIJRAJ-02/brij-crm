import { Checkbox as AriaCheckbox, type CheckboxProps as AriaCheckboxProps, Radio as AriaRadio, RadioGroup as AriaRadioGroup, type RadioGroupProps, type RadioProps, Switch as AriaSwitch, type SwitchProps as AriaSwitchProps, Label } from 'react-aria-components';
import { useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import './Checkbox.css';

/** A yes/no that saves with its form, or a row selection. `round` for marking a task done. */
export function Checkbox({ children, round = false, className, ...rest }: Omit<AriaCheckboxProps, 'children' | 'className'> & { readonly children?: ReactNode; readonly round?: boolean; readonly className?: string }) {
  return (
    <AriaCheckbox {...rest} className={cx('tf-check', round && 'tf-check--round', className)}>
      <span className="tf-check__box" aria-hidden="true">
        <svg viewBox="0 0 18 18"><path className="tf-check__tick" d="M4.5 9.5 7.5 12.5 13.5 5.5" pathLength={1} /><path className="tf-check__dash" d="M5 9h8" /></svg>
      </span>
      {children !== undefined && <span className="tf-check__label">{children}</span>}
    </AriaCheckbox>
  );
}

/** One of two to five visible choices. */
export function RadioGroup({ label, children, className, ...rest }: Omit<RadioGroupProps, 'children' | 'className'> & { readonly label?: string; readonly children: ReactNode; readonly className?: string }) {
  return (
    <AriaRadioGroup {...rest} className={cx('tf-radio-group', className)}>
      {label && <Label className="tf-radio-group__label">{label}</Label>}
      <div className="tf-radio-group__items">{children}</div>
    </AriaRadioGroup>
  );
}

/** One choice inside a RadioGroup. */
export function Radio({ children, ...rest }: Omit<RadioProps, 'children' | 'className'> & { readonly children: ReactNode }) {
  return (
    <AriaRadio {...rest} className="tf-check tf-check--radio">
      <span className="tf-check__box" aria-hidden="true"><span className="tf-check__dot" /></span>
      <span className="tf-check__label">{children}</span>
    </AriaRadio>
  );
}

/** A setting that takes effect at once. No Save button follows a switch. */
export function Switch({ children, onChange, ...rest }: Omit<AriaSwitchProps, 'children' | 'className'> & { readonly children?: ReactNode }) {
  const [touched, setTouched] = useState(false);
  return (
    <AriaSwitch {...rest} onChange={(v) => { setTouched(true); onChange?.(v); }} className={cx('tf-switch', touched && 'is-touched')}>
      <span className="tf-switch__track" aria-hidden="true"><span className="tf-switch__thumb" /></span>
      {children !== undefined && <span className="tf-check__label">{children}</span>}
    </AriaSwitch>
  );
}
