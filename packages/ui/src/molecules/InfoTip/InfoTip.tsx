import type { ReactNode } from 'react';
import { ButtonContext, DialogTrigger } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Popover, type PopoverPlacement } from '../Popover/Popover.tsx';
import styles from './InfoTip.module.css';
import { strings } from './strings.ts';

/** Props for InfoTip. */
export interface InfoTipProps {
  /** What it explains, as the label beside it says it ("Minimum notice"): the button is named "About Minimum notice". */
  readonly label: string;
  /** One or two plain sentences on what the setting does. */
  readonly children: ReactNode;
  /** A worked example, under the text: "With 4 hours, a 9:00 slot can't be booked after 5:00 that morning." */
  readonly example?: ReactNode;
  readonly placement?: PopoverPlacement;
  /** `sm` (the default) sits beside a label or a row's title; `md` beside a control. */
  readonly size?: 'sm' | 'md';
}

/**
 * A small info button beside a label that needs a word of help. Pressing it
 * (pointer, touch, Enter or Space) opens a short popover with the help and an
 * optional example; Esc or a press outside closes it and focus returns to the
 * button. Never on a field whose label already says it all.
 */
export function InfoTip({ label, children, example, placement = 'bottom start', size = 'sm' }: InfoTipProps) {
  const name = strings.about(label);
  // Inside a Select (whose context would turn any button into its trigger), the help button stays its own.
  return (
    <ButtonContext.Provider value={null}>
      <DialogTrigger>
        <Button variant="ghost" size={size} icon="info" label={name} />
        <Popover label={name} placement={placement}>
          <div className={styles.body}>
            <p className={styles.text}>{children}</p>
            {example !== undefined && (
              <p className={styles.example}>
                <span className={styles.exampleLabel}>{strings.example}</span> {example}
              </p>
            )}
          </div>
        </Popover>
      </DialogTrigger>
    </ButtonContext.Provider>
  );
}
