import { useRef } from 'react';
import { CopyButton } from '../Button/CopyButton.tsx';
import styles from './Code.module.css';

/**
 * Where the code sits: `inline` (the default) in a sentence; `block` on its own line, in a full width box that
 * wraps only between space separated groups (a setup key); `list` one code per line of `children`, in two columns of
 * whole codes (backup codes). Block and list keep the copy button inside the box, at its end.
 */
export type CodeVariant = 'inline' | 'block' | 'list';

/** Props for Code. */
export interface CodeProps {
  /** The code: a key, a webhook URL, a field's API name. For `list`, one code per line ("\n" between them). */
  readonly children: string;
  /** `inline` (the default), `block` or `list`. */
  readonly variant?: CodeVariant;
  /** Adds a copy button after it (inside the box for `block` and `list`). A list copies one code per line. */
  readonly isCopyable?: boolean;
  /** The copy button's name, when "Copy" isn't specific enough ("Copy the API key"). */
  readonly copyLabel?: string;
}

/** Code in the mono `code` style: inline, on its own line, or a list of codes, with an optional copy button. */
export function Code({ children, variant = 'inline', isCopyable = false, copyLabel }: CodeProps) {
  const ref = useRef<HTMLElement>(null);
  const copy = isCopyable ? (
    <CopyButton
      value={children}
      isIconOnly
      variant="ghost"
      sourceRef={ref}
      {...(copyLabel === undefined ? {} : { label: copyLabel })}
    />
  ) : null;

  if (variant === 'inline') {
    const code = (
      <code ref={ref} className={styles.root}>
        {children}
      </code>
    );
    if (copy === null) return code;
    return (
      <span className={styles.copyable}>
        {code}
        {copy}
      </span>
    );
  }

  // Each code whole, in the order given; blank lines (a trailing "\n") draw nothing.
  const lines = variant === 'list' ? children.split('\n').filter((line) => line.trim() !== '') : [];
  return (
    <div className={styles.box} data-variant={variant} {...(copy === null ? {} : { 'data-copyable': true })}>
      <code ref={ref} className={styles.text}>
        {variant === 'list'
          ? lines.map((line, index) => (
              <span key={`${String(index)}-${line}`} className={styles.item}>
                {line}
              </span>
            ))
          : children}
      </code>
      {copy}
    </div>
  );
}
