import { useRef } from 'react';
import { CopyButton } from '../Button/CopyButton.tsx';
import styles from './Code.module.css';

/** Props for Code. */
export interface CodeProps {
  /** The code: a key, a webhook URL, a field's API name. */
  readonly children: string;
  /** Adds a copy button after it. */
  readonly isCopyable?: boolean;
  /** The copy button's name, when "Copy" isn't specific enough ("Copy the API key"). */
  readonly copyLabel?: string;
}

/** Code in the mono `code` style, inline or on its own, with an optional copy button. */
export function Code({ children, isCopyable = false, copyLabel }: CodeProps) {
  const ref = useRef<HTMLElement>(null);
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
