import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Eye, EyeOff, WrapText } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../Text/Text.tsx';
import { IconSwap } from '../Motion/Motion.tsx';
import './Code.css';

const i14 = { size: 14, strokeWidth: 1.75 } as const;

/** Copies text, then shows a check for 1.6s. Tracks only the confirmation; the clipboard call is fire and forget. */
function useCopy(): readonly [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const t = useRef(0);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return [copied, copy];
}

/** Props for CopyButton. */
export interface CopyButtonProps {
  readonly value: string;
  /** Its name and tooltip: "Copy", or something specific ("Copy the API key"). */
  readonly label?: string;
}

/** A 28px ghost icon button that copies `value`; the copy icon swaps to a check and "Copied" is announced. */
export function CopyButton({ value, label = 'Copy' }: CopyButtonProps) {
  const [copied, copy] = useCopy();
  return (
    <>
      <Tooltip label={copied ? 'Copied' : label}>
        <IconButton size="sm" label={label} onPress={() => copy(value)}>
          <IconSwap isB={copied} a={<Copy {...i14} />} b={<Check {...i14} />} />
        </IconButton>
      </Tooltip>
      <VisuallyHidden isInline><span aria-live="polite">{copied ? 'Copied' : ''}</span></VisuallyHidden>
    </>
  );
}

/** Code inside a sentence: a field's API name, a short value. Mono on a subtle ground. */
export function Code({ children }: { readonly children: string }) {
  return <code className="tf-code">{children}</code>;
}

/** Props for CodeBlock. */
export interface CodeBlockProps {
  readonly code: string;
  /** A small header line: "Embed snippet · HTML". Without it the buttons float at the top right. */
  readonly title?: string;
  /** Shows the copy button (on by default). */
  readonly isCopyable?: boolean;
  readonly copyLabel?: string;
  /** Shows a toggle between scrolling long lines and wrapping them. */
  readonly canWrap?: boolean;
  /** Starts wrapped. */
  readonly defaultWrapped?: boolean;
}

/** A block of code (an embed snippet, a webhook payload) in mono on surface-subtle, with copy and an optional wrap toggle. */
export function CodeBlock({ code, title, isCopyable = true, copyLabel, canWrap = false, defaultWrapped = false }: CodeBlockProps) {
  const [wrapped, setWrapped] = useState(defaultWrapped);
  const actions = (
    <span className="tf-codeblock__actions">
      {canWrap && (
        <Tooltip label={wrapped ? 'Scroll long lines' : 'Wrap long lines'}>
          <IconButton size="sm" label="Wrap long lines" aria-pressed={wrapped} onPress={() => setWrapped((w) => !w)}>
            <WrapText {...i14} />
          </IconButton>
        </Tooltip>
      )}
      {isCopyable && <CopyButton value={code} label={copyLabel} />}
    </span>
  );
  return (
    <div className={cx('tf-codeblock', title === undefined && 'tf-codeblock--bare')}>
      {title !== undefined && <div className="tf-codeblock__head"><span>{title}</span>{actions}</div>}
      {title === undefined && actions}
      <pre className={cx('tf-codeblock__pre', wrapped && 'tf-codeblock__pre--wrap')} tabIndex={0}><code>{code}</code></pre>
    </div>
  );
}

/** Props for SecretKey. */
export interface SecretKeyProps {
  readonly value: string;
  /** What it is, for the buttons' names: "API key". */
  readonly label: string;
  /** How many characters stay visible at the end while masked (default 4). */
  readonly visibleEnd?: number;
}

/** An API key or signing secret, masked with its prefix and last four shown, a reveal toggle (eye swap) and copy. */
export function SecretKey({ value, label, visibleEnd = 4 }: SecretKeyProps) {
  const [shown, setShown] = useState(false);
  const prefix = /^[a-z]+_(live|test)_/i.exec(value)?.[0] ?? '';
  const masked = `${prefix}${'•'.repeat(12)}${value.slice(-visibleEnd)}`;
  return (
    <div className="tf-secret">
      <code className="tf-secret__value" aria-hidden={!shown}>{shown ? value : masked}</code>
      {!shown && <VisuallyHidden isInline>{`${label}, hidden, ends in ${value.slice(-visibleEnd)}`}</VisuallyHidden>}
      <Tooltip label={shown ? `Hide ${label}` : `Show ${label}`}>
        <IconButton size="sm" label={`Show ${label}`} aria-pressed={shown} onPress={() => setShown((s) => !s)}>
          <IconSwap isB={shown} a={<Eye {...i14} />} b={<EyeOff {...i14} />} />
        </IconButton>
      </Tooltip>
      <CopyButton value={value} label={`Copy ${label}`} />
    </div>
  );
}
