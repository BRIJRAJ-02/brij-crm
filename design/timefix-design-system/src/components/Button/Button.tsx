import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { createContext, useContext, type ReactNode, type Ref } from 'react';
import { cx } from '../../lib/cx.ts';
import { Spinner } from '../Motion/Motion.tsx';
import './Button.css';

/** How loud a button is. One `primary` per view region at most. */
export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
/** 28px toolbars, 36px app default, 44px public pages and settings forms. */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Where a button with an icon drops its label and keeps only the icon (the name stays for screen readers):
 *  `phone` below 640px of screen, `narrow` when its container is under 34rem. */
export type ButtonCollapse = 'phone' | 'narrow';
/** Lets a toolbar collapse the buttons inside it without each caller saying so; `only` limits it to one variant. */
export const ButtonCollapseContext = createContext<{ readonly below: ButtonCollapse; readonly only?: ButtonVariant } | undefined>(undefined);

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
  /** The button element, for moving focus to it. */
  readonly ref?: Ref<HTMLButtonElement>;
  /** Drop the label and keep the icon on a phone or in a narrow container. Needs an icon. */
  readonly collapse?: ButtonCollapse;
}

/** A pill that starts an action. Ink primary, white secondary, grey soft, bare ghost, red danger. */
export function Button({ variant = 'secondary', size = 'md', isPending = false, icon, iconEnd, children, className, collapse, ...rest }: ButtonProps) {
  const ctx = useContext(ButtonCollapseContext);
  const folds = icon !== undefined && children !== undefined ? collapse ?? (ctx && (!ctx.only || ctx.only === variant) ? ctx.below : undefined) : undefined;
  return (
    <AriaButton {...rest} isPending={isPending} className={cx('tf-btn', `tf-btn--${variant}`, `tf-btn--${size}`, folds && `tf-btn--collapse-${folds}`, className)}>
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
