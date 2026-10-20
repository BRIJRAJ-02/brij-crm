import type { RefObject } from 'react';
import { useToasts } from '../../provider/context.ts';
import { Button, type ButtonSize, type ButtonVariant } from './Button.tsx';
import { strings } from './strings.ts';

/** Props for CopyButton. */
export interface CopyButtonProps {
  /** The text it copies. */
  readonly value: string;
  /** The button's label; "Copy" when left out. */
  readonly label?: string;
  /** Shows the copy icon alone, with `label` as its name. */
  readonly isIconOnly?: boolean;
  readonly variant?: ButtonVariant;
  /** `lg` beside other large controls (a link card's footer); `md` by default. */
  readonly size?: ButtonSize;
  /** The element showing the text. If the copy fails, its text is selected so it can be copied by hand. */
  readonly sourceRef?: RefObject<HTMLElement | null>;
  /** Nothing to copy yet (a form never published, a copy still on its way). */
  readonly isDisabled?: boolean;
}

function selectText(element: HTMLElement | null | undefined) {
  if (element === null || element === undefined) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * A Button that copies a value to the clipboard and says so in a toast. If the
 * browser refuses, an error toast says to copy it by hand, and the text is
 * selected for that.
 */
export function CopyButton({
  value,
  label = strings.copy,
  isIconOnly = false,
  variant = 'secondary',
  size = 'md',
  sourceRef,
  isDisabled = false,
}: CopyButtonProps) {
  const toasts = useToasts();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toasts.toast({ tone: 'success', message: strings.copied });
    } catch {
      selectText(sourceRef?.current);
      toasts.toast({ tone: 'danger', message: strings.copyFailed });
    }
  };
  const onPress = () => {
    void copy();
  };
  return isIconOnly ? (
    <Button variant={variant} size={size} icon="copy" label={label} onPress={onPress} isDisabled={isDisabled} />
  ) : (
    <Button variant={variant} size={size} icon="copy" onPress={onPress} isDisabled={isDisabled}>
      {label}
    </Button>
  );
}
