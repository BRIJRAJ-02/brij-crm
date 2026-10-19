import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import styles from './SpanCard.module.css';
import { strings } from './strings.ts';

/** One thing a drawn span can become ("Block this time"). */
export interface SpanCardChoice {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly onPress: () => void;
}

/** Props for SpanCard. */
export interface SpanCardProps {
  /** The span ("10:00 – 10:30 AM"). */
  readonly title: string;
  /** Its day and length ("Tuesday 20 October · 30 min"). */
  readonly meta: string;
  /** Shows Back, to the choices, while a choice's form is open. */
  readonly onBack?: () => void;
  /** What the span can become, as a list; or leave it off and pass the form open. */
  readonly choices?: readonly SpanCardChoice[];
  readonly children?: ReactNode;
  /**
   * Names what the card shows (`choose`, `block`, `done`): when it changes,
   * focus moves to the first control below the span, since the control that
   * was pressed (a choice, Back, Block it) is gone.
   */
  readonly focusKey?: string;
}

/**
 * The card a span drawn on a week opens (spec 0027): the span and its day
 * first, then either the choices it can become (book, block, hold) or the
 * form of the one picked, with Back to the choices. It sits in WeekCalendar's
 * draft card; the screen owns what each choice does.
 */
export function SpanCard({ title, meta, onBack, choices, children, focusKey }: SpanCardProps) {
  const body = useRef<HTMLDivElement>(null);
  const shown = useRef(focusKey);
  useEffect(() => {
    if (shown.current === focusKey) return;
    shown.current = focusKey;
    body.current?.querySelector<HTMLElement>('input:not([type="hidden"]), button, [tabindex="0"]')?.focus();
  }, [focusKey]);
  return (
    <div className={styles.root}>
      <div className={styles.head}>
        {onBack !== undefined && <Button variant="ghost" icon="chevron-left" label={strings.back} onPress={onBack} />}
        <div className={styles.names}>
          <span className={styles.title}>{title}</span>
          <span className={styles.meta}>{meta}</span>
        </div>
      </div>
      <div ref={body} className={styles.body}>
        {choices !== undefined && (
          <ul className={styles.choices}>
            {choices.map((choice) => (
              <li key={choice.id}>
                <Button variant="ghost" icon={choice.icon} isFullWidth onPress={choice.onPress}>
                  {choice.label}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>
    </div>
  );
}
