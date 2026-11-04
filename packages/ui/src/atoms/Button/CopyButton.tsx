import { useEffect, useState, type RefObject } from 'react';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import { useToasts } from '../../provider/context.ts';
import { Button, type ButtonSize, type ButtonVariant } from './Button.tsx';
import { strings } from './strings.ts';

/** Props for CopyButton. */
export interface CopyButtonProps {
  /**
   * The text it copies, or a read that answers it on the press (a guest's link, which carries their key and is read
   * only when asked for): the clipboard is handed the read itself while the press still counts as the person's, since
   * Safari refuses a write made after an awaited request. The button is busy while it reads.
   */
  readonly value: string | (() => Promise<string>);
  /** The button's label; "Copy" when left out. */
  readonly label?: string;
  /** Shows the copy icon alone, with `label` as its name. */
  readonly isIconOnly?: boolean;
  /** In a narrow bar (its container under 480px, a phone) the words hide and the icon stands alone, named by `label`. */
  readonly isLabelCollapsible?: boolean;
  readonly variant?: ButtonVariant;
  /** `lg` beside other large controls (a link card's footer); `md` by default. */
  readonly size?: ButtonSize;
  /** The element showing the text. If the copy fails, its text is selected so it can be copied by hand. */
  readonly sourceRef?: RefObject<HTMLElement | null>;
  /** Nothing to copy yet (a form never published, a copy still on its way). */
  readonly isDisabled?: boolean;
  /** What screen readers hear once it copied ("Link copied"); "Copied" by default. */
  readonly announcement?: string;
  /** The toast when the browser refuses, where the default's "Select the link" doesn't fit (no link shown). */
  readonly failureMessage?: string;
  /** Fully rounded: a pill (a link page's address under the person's name). */
  readonly isRound?: boolean;
  /**
   * A fuller accessible name while it hasn't copied, starting with the visible label (WCAG 2.5.3): a label that is
   * the value itself ("timefix.com/ada") says what pressing it does ("timefix.com/ada, copy link").
   */
  readonly name?: string;
}

function selectText(element: HTMLElement | null | undefined) {
  if (element === null || element === undefined) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** How long the button says Copied, in milliseconds. */
export const COPIED_MS = 2000;

/**
 * A Button that copies a value to the clipboard. Once it lands, the icon turns to a check and the label to
 * "Copied" for two seconds, at the width it had (the longer label's room is kept from the start), and a live
 * region tells screen readers (`announcement`, "Copied" by default). If the browser refuses, an error toast says to
 * copy it by hand, and the text is selected for that.
 */
export function CopyButton({
  value,
  label = strings.copy,
  isIconOnly = false,
  isLabelCollapsible = false,
  variant = 'secondary',
  size = 'md',
  sourceRef,
  isDisabled = false,
  announcement = strings.copiedAnnouncement,
  failureMessage = strings.copyFailed,
  isRound = false,
  name,
}: CopyButtonProps) {
  const toasts = useToasts();
  // Bumped on each copy, so a second press restarts the two seconds.
  const [copiedAt, setCopiedAt] = useState(0);
  const [isReading, setReading] = useState(false);
  const isCopied = copiedAt > 0;
  useEffect(() => {
    if (copiedAt === 0) return undefined;
    const timer = setTimeout(() => setCopiedAt(0), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);
  const copy = async () => {
    try {
      if (typeof value === 'string') await navigator.clipboard.writeText(value);
      else {
        setReading(true);
        const text = value();
        if (typeof ClipboardItem === 'function') {
          await navigator.clipboard.write([
            new ClipboardItem({ 'text/plain': text.then((each) => new Blob([each], { type: 'text/plain' })) }),
          ]);
        } else {
          await navigator.clipboard.writeText(await text);
        }
      }
      setCopiedAt((count) => count + 1);
    } catch {
      selectText(sourceRef?.current);
      toasts.toast({ tone: 'danger', message: failureMessage });
    } finally {
      setReading(false);
    }
  };
  const onPress = () => {
    void copy();
  };
  const icon = isCopied ? 'check' : 'copy';
  return (
    <>
      {isIconOnly ? (
        <Button
          variant={variant}
          size={size}
          icon={icon}
          label={label}
          onPress={onPress}
          isDisabled={isDisabled}
          isPending={isReading}
          {...(isRound ? { isRound } : {})}
        />
      ) : (
        <Button
          variant={variant}
          size={size}
          icon={icon}
          onPress={onPress}
          isDisabled={isDisabled}
          isPending={isReading}
          labelReserve={isCopied ? label : strings.copiedLabel}
          {...(isRound ? { isRound } : {})}
          {...(name !== undefined && !isCopied ? { label: name } : {})}
          {...(isLabelCollapsible ? { isLabelCollapsible: true, label: isCopied ? strings.copiedLabel : label } : {})}
        >
          {isCopied ? strings.copiedLabel : label}
        </Button>
      )}
      <VisuallyHidden>
        <span role="status">{isCopied ? announcement : ''}</span>
      </VisuallyHidden>
    </>
  );
}
