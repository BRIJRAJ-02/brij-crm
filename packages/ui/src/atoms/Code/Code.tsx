import { useId, useRef, useState } from 'react';
import { Button } from '../Button/Button.tsx';
import { CopyButton } from '../Button/CopyButton.tsx';
import styles from './Code.module.css';
import { strings } from './strings.ts';

/** Props for Code. */
export interface CodeProps {
  /** The code: a key, a webhook URL, a field's API name, a snippet. */
  readonly children: string;
  /** Adds a copy button after it (inline), or inside its top end (block, which always has one). */
  readonly isCopyable?: boolean;
  /** The copy button's name, when "Copy" isn't specific enough ("Copy the API key"). */
  readonly copyLabel?: string;
  /**
   * `inline` (the default) sits in a line of text. `block` is a snippet to
   * paste somewhere: its own box, lines kept, with Copy inside its top end.
   */
  readonly variant?: 'inline' | 'block';
  /** Block only: holds a long snippet to a few lines under a fade, with "Show all" to open it. */
  readonly isClamped?: boolean;
}

/** A snippet in its own box: lines kept, Copy inside, and optionally held to a few lines until opened. */
function CodeBlock({ children, copyLabel, isClamped }: Pick<CodeProps, 'children' | 'copyLabel' | 'isClamped'>) {
  const ref = useRef<HTMLElement>(null);
  const id = useId();
  const [isOpen, setOpen] = useState(false);
  const isHeld = isClamped === true && !isOpen;
  return (
    <div className={styles.block}>
      <div className={styles.box}>
        <span className={styles.copy}>
          <CopyButton value={children} sourceRef={ref} label={copyLabel ?? strings.copy} variant="ghost" />
        </span>
        <pre id={id} className={styles.pre} data-clamped={isHeld || undefined}>
          <code ref={ref}>{children}</code>
        </pre>
      </div>
      {isClamped === true && (
        <Button
          variant="ghost"
          size="sm"
          icon={isOpen ? 'chevron-up' : 'chevron-down'}
          onPress={() => {
            setOpen((open) => !open);
          }}
        >
          {isOpen ? strings.showLess : strings.showAll}
        </Button>
      )}
    </div>
  );
}

/** Code in the mono `code` style, inline or as a block to paste, with an optional copy button. */
export function Code({ children, isCopyable = false, copyLabel, variant = 'inline', isClamped }: CodeProps) {
  const ref = useRef<HTMLElement>(null);
  if (variant === 'block') {
    return (
      <CodeBlock
        {...(copyLabel === undefined ? {} : { copyLabel })}
        {...(isClamped === undefined ? {} : { isClamped })}
      >
        {children}
      </CodeBlock>
    );
  }
  const code = (
    <code ref={ref} className={styles.root}>
      {children}
    </code>
  );
  if (!isCopyable) return code;
  return (
    <span className={styles.copyable}>
      {code}
      <CopyButton
        value={children}
        isIconOnly
        variant="ghost"
        sourceRef={ref}
        {...(copyLabel === undefined ? {} : { label: copyLabel })}
      />
    </span>
  );
}
