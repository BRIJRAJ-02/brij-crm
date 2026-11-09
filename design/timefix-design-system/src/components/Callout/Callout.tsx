import { Button as AriaButton } from 'react-aria-components';
import { useState, type ReactNode } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, Info, Lightbulb, TriangleAlert, X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { IconButton } from '../Button/Button.tsx';
import { motionMs } from '../FloatingBar/FloatingBar.tsx';
import './Callout.css';

/** The callout's colour and icon. */
export type CalloutTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Props for Callout. */
export interface CalloutProps {
  readonly tone?: CalloutTone;
  /** An optional bold first line. */
  readonly title?: string;
  /** One or two sentences: what is true and what to do about it. */
  readonly children: ReactNode;
  /** One follow-up, drawn as a link with an arrow ("Reconnect"). */
  readonly action?: { readonly label: string; readonly onPress: () => void };
  /** Shows × and collapses the callout away (accordion motion) before calling this. */
  readonly onDismiss?: () => void;
  readonly className?: string;
}

const ICONS = { neutral: Lightbulb, info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert } as const;

/** A message that stays on the page until its cause is fixed or the user dismisses it: an icon per tone, a sentence, one action. Danger and warning are announced; dismissing collapses it in 250ms. */
export function Callout({ tone = 'info', title, children, action, onDismiss, className }: CalloutProps) {
  const [closing, setClosing] = useState(false);
  const Icon = ICONS[tone];
  const dismiss = () => {
    setClosing(true);
    window.setTimeout(() => onDismiss?.(), motionMs('--duration-fast', 250));
  };
  return (
    <div className={cx('tf-callout-wrap', className)} data-closing={closing || undefined}>
      <div className="tf-callout-clip">
        <div className={cx('tf-callout', `tf-callout--${tone}`)} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
          <Icon className="tf-callout__icon" size={16} strokeWidth={1.75} aria-hidden="true" />
          <div className="tf-callout__text">
            {title !== undefined && <p className="tf-callout__title">{title}</p>}
            <div className="tf-callout__body">{children}</div>
            {action && (
              <AriaButton className="tf-callout__action" onPress={action.onPress}>
                {action.label}<ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </AriaButton>
            )}
          </div>
          {onDismiss && <IconButton label="Dismiss" size="sm" className="tf-callout__close" onPress={dismiss}><X size={14} strokeWidth={1.75} /></IconButton>}
        </div>
      </div>
    </div>
  );
}
