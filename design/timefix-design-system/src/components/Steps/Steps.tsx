import { Button as AriaButton } from 'react-aria-components';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { SuccessCheck } from '../Motion/Motion.tsx';
import './Steps.css';

/** One step of a flow. */
export interface Step {
  readonly id: string;
  /** A short noun or verb ("Details", "Connect your calendar"). */
  readonly label: string;
  /** Vertical only: one grey line under the label. */
  readonly description?: ReactNode;
}

/** Props for Steps. */
export interface StepsProps {
  readonly steps: readonly Step[];
  /** The index of the step the user is on. Steps before it are done. */
  readonly current: number;
  /** `horizontal` across the top of a flow; `vertical` down the side of a setup page. */
  readonly orientation?: 'horizontal' | 'vertical';
  /** Lets the user go back to a done step. Steps ahead never take a press. */
  readonly onStepPress?: (index: number) => void;
  /** Names the list ("Booking setup"). */
  readonly 'aria-label'?: string;
}

/** Where the user is in a multi-step flow: numbers ahead, a blue ring on the current step, and done steps that turn into a drawn tick. */
export function Steps({ steps, current, orientation = 'horizontal', onStepPress, 'aria-label': ariaLabel = 'Progress' }: StepsProps) {
  return (
    <ol className={cx('tf-steps', `tf-steps--${orientation}`)} aria-label={ariaLabel}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming';
        const inner = (
          <>
            <span className="tf-steps__marker" aria-hidden="true">{state === 'done' ? <SuccessCheck size={14} /> : <span className="tf-num">{i + 1}</span>}</span>
            <span className="tf-steps__text">
              <span className="tf-steps__label">{s.label}<span className="tf-sr-only">{state === 'done' ? ', done' : state === 'upcoming' ? ', not started' : ''}</span></span>
              {orientation === 'vertical' && s.description !== undefined && <span className="tf-steps__desc">{s.description}</span>}
            </span>
          </>
        );
        return (
          <li key={s.id} className="tf-steps__item" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            {state === 'done' && onStepPress ? <AriaButton className="tf-steps__step tf-steps__step--button" onPress={() => onStepPress(i)}>{inner}</AriaButton> : <span className="tf-steps__step">{inner}</span>}
            {i < steps.length - 1 && <span className="tf-steps__line" aria-hidden="true"><span className="tf-steps__fill" /></span>}
          </li>
        );
      })}
    </ol>
  );
}
