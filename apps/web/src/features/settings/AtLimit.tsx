// A create button that turns off at its plan limit (flow pass, 30 October 2026): New object, New attribute and the
// grid's "+" were pressable at the limit and refused only after the person had filled the dialog in. Off, the
// button says why beside it ("12 of 12 used. Archive one first."), tied to it by aria-describedby (Button's README).
import { LockReason, VisuallyHidden } from '@crm/ui';
import { useId, type ReactNode } from 'react';
import { strings } from './attribute-strings.ts';

/** How much of a limit is used, as `usage.get` answers it; undefined when it could not be read. */
export interface LimitCount {
  readonly used: number;
  readonly limit: number;
}

/** What a button at its limit needs: whether it is off, the props that tie it to the reason, and the reason. */
export interface AtLimit {
  readonly isFull: boolean;
  /** Spread onto the Button: `isDisabled` and `aria-describedby` while full, nothing otherwise. */
  readonly buttonProps: { readonly isDisabled?: true; readonly 'aria-describedby'?: string };
  /** Drawn beside the button: the reason, visible as a lock and read with the button. Nothing while not full. */
  readonly reason: ReactNode;
}

/** Whether `count` is full; an unread count never turns anything off (the server still refuses past it). */
export function isAtLimit(count: LimitCount | undefined): boolean {
  return count !== undefined && count.used >= count.limit;
}

/** A create button's limit: off at the limit, with the reason beside it. */
export function useAtLimit(count: LimitCount | undefined): AtLimit {
  const id = useId();
  if (count === undefined || !isAtLimit(count)) return { isFull: false, buttonProps: {}, reason: null };
  const words = strings.atLimit(count.limit);
  return {
    isFull: true,
    buttonProps: { isDisabled: true, 'aria-describedby': id },
    reason: (
      <>
        <VisuallyHidden id={id}>{words}</VisuallyHidden>
        <LockReason reason={words} />
      </>
    ),
  };
}
