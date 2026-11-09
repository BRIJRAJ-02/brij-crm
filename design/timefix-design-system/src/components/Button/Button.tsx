import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { Spinner } from '../Motion/Motion.tsx';
import './Button.css';

/** How loud a button is. One `primary` per view region at most. */
export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
/** 28px toolbars, 36px app default, 44px public pages and settings forms. */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Props for Button: React Aria's button plus our look. */
export interface ButtonProps extends Omit<AriaButtonProps, 'children' | 'className'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Shows a spinner in place of the icon and keeps the width; the press is ignored. */
  readonly isPending?: boolean;
  readonly icon?: ReactNode;
  readonly iconEnd?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}

/** A pill that starts an action. Ink primary, white secondary, grey soft, bare ghost, red danger. */
export function Button({ variant = 'secondary', size = 'md', isPending = false, icon, iconEnd, children, className, ...rest }: ButtonProps) {
  return (
    <AriaButton {...rest} isPending={isPending} className={cx('tf-btn', `tf-btn--${variant}`, `tf-btn--${size}`, className)}>
      {isPending ? <Spinner size={size === 'sm' ? 14 : 16} label="Working" /> : icon}
      {children !== undefined && <span className="tf-btn__label">{children}</span>}
      {iconEnd}
    </AriaButton>
  );
}

/** Props for IconButton: the icon and a required accessible label. */
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'iconEnd'> {
  readonly label: string;
  readonly children: ReactNode;
}

/** A round button holding only an icon. Always has an aria-label; pair it with a Tooltip in the UI. */
export function IconButton({ label, children, variant = 'ghost', className, ...rest }: IconButtonProps) {
  return (
    <Button {...rest} variant={variant} aria-label={label} className={cx('tf-btn--icon', className)} icon={children} />
  );
}
