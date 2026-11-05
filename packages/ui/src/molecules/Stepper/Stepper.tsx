// A count a guest changes one at a time: one fewer, the count (its digits popping as it changes), one more. Built
// for the guest pages after checklabs' steppers (the guest menu's row stepper, its dish sheet's quantity, the
// selection's lines, the reservation's party size), from library Buttons, FieldLabel and NumberPop.
import { useEffect, useId, useRef } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { FieldLabel } from '../../atoms/FieldLabel/FieldLabel.tsx';
import { NumberPop } from '../../atoms/NumberPop/NumberPop.tsx';
import styles from './Stepper.module.css';
import { strings } from './strings.ts';

/**
 * `sm`: 30px, 26px buttons, the count in the strong body style. `md`: 40px, 36px buttons, the count in the heading
 * style (a reservation's party size). `lg`: 48px, 30px buttons, the count in the title style. `row` and `sheet` are
 * checklabs' own steppers, value for value, with the − and + in the text colour and drawn bolder: `row` 30px, 2px in,
 * 24px buttons and a 13px semibold count (the guest menu's dish rows and the selection's lines); `sheet` 48px, 32px
 * buttons and the count in the title style (a dish sheet's foot, beside Button's 48px `sheet`).
 */
export type StepperSize = 'sm' | 'md' | 'lg' | 'row' | 'sheet';

/** `default`: a hairline pill on the card. `filled`: a pill of the chip colour with no line (checklabs' cream). */
export type StepperTone = 'default' | 'filled';

/** Props for Stepper. */
export interface StepperProps {
  /** Names the count ("Quantity", "Party size", "How many Flat white"): drawn over the pill unless `isLabelHidden`. */
  readonly label: string;
  /** Keeps the name for screen readers only, where the page shows what the count is beside it. */
  readonly isLabelHidden?: boolean;
  /** The count. */
  readonly value: number;
  /** The count after a press: one fewer or one more, never past `min` or `max`. Left out, both buttons are off. */
  readonly onChange?: (value: number) => void;
  /** The least the count may be: one fewer turns off there. Defaults to 0. */
  readonly min?: number;
  /** The most the count may be: one more turns off there. Defaults to no limit. */
  readonly max?: number;
  readonly size?: StepperSize;
  readonly tone?: StepperTone;
  /** Both buttons off and the count faded (the label keeps its colour: it still names the group). */
  readonly isDisabled?: boolean;
  /** One fewer's name, when it does more than that ("Remove Flat white" at one). */
  readonly fewerLabel?: string;
  /** One more's name ("Add another Flat white"). */
  readonly moreLabel?: string;
  /**
   * The count and one more only, no fewer: a count taken away elsewhere (a dish with choices on the guest menu's row,
   * where which pick to take away is the selection's call).
   */
  readonly isFewerHidden?: boolean;
  /**
   * Whether the count is a polite live region (the default). Off where the page already says each change in its own
   * words (the guest menu's rows: "Added Flat white. 2 in your selection."), so it isn't said twice.
   */
  readonly isCountAnnounced?: boolean;
}

/** The Button size each Stepper size draws its buttons at (`row` and `sheet` resize theirs, 24px and 32px). */
const BUTTON_SIZE = { sm: 'md', md: 'xl', lg: 'lg', row: 'md', sheet: 'lg' } as const;

/**
 * A count changed one at a time, as a group: one fewer, the count, one more. Each button is drawn small and pressed
 * across 44px (Button's `isTouchTarget`), since a guest presses it with a thumb. It holds no count of its own: the
 * caller's `value`, changed through `onChange`. A press that reaches `min` or `max` turns its own button off, and
 * focus moves to the other button, so it never falls out of the group (to a dialog's Close).
 */
export function Stepper({
  label,
  isLabelHidden = false,
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  size = 'sm',
  tone = 'default',
  isDisabled = false,
  fewerLabel = strings.fewer,
  moreLabel = strings.more,
  isFewerHidden = false,
  isCountAnnounced = true,
}: StepperProps) {
  const labelId = useId();
  const canChange = !isDisabled && onChange !== undefined;
  const isFewerOff = !canChange || value <= min;
  const isMoreOff = !canChange || value >= max;
  // Which button was pressed last, while focus was on it: a button turned off may already have lost focus to the
  // body by the time the change lands.
  const fewerRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef<'fewer' | 'more' | undefined>(undefined);
  useEffect(() => {
    const lost = document.activeElement === fewerRef.current || document.activeElement === document.body;
    if (isFewerOff && pressed.current === 'fewer' && lost) moreRef.current?.focus();
  }, [isFewerOff]);
  useEffect(() => {
    const lost = document.activeElement === moreRef.current || document.activeElement === document.body;
    if (isMoreOff && pressed.current === 'more' && lost) fewerRef.current?.focus();
  }, [isMoreOff]);
  const count = <NumberPop value={String(value)} />;
  const pill = (
    <span
      className={styles.pill}
      data-size={size}
      data-tone={tone}
      data-fewer-hidden={isFewerHidden || undefined}
      data-disabled={isDisabled || undefined}
      role="group"
      {...(isLabelHidden ? { 'aria-label': label } : { 'aria-labelledby': labelId })}
    >
      {/* Draws nothing of its own (display: contents): it carries `row` and `sheet`'s bolder glyph to the buttons. */}
      <span className={styles.track}>
        {isFewerHidden ? null : (
          <Button
            ref={fewerRef}
            variant="ghost"
            size={BUTTON_SIZE[size]}
            icon="minus"
            label={fewerLabel}
            isRound
            isTouchTarget
            isDisabled={isFewerOff}
            onPress={() => {
              pressed.current = document.activeElement === fewerRef.current ? 'fewer' : undefined;
              onChange?.(Math.max(min, value - 1));
            }}
          />
        )}
        {isCountAnnounced ? (
          <output className={styles.value} aria-live="polite">
            {count}
          </output>
        ) : (
          <span className={styles.value}>{count}</span>
        )}
        <Button
          ref={moreRef}
          variant="ghost"
          size={BUTTON_SIZE[size]}
          icon="plus"
          label={moreLabel}
          isRound
          isTouchTarget
          isDisabled={isMoreOff}
          onPress={() => {
            pressed.current = document.activeElement === moreRef.current ? 'more' : undefined;
            onChange?.(Math.min(max, value + 1));
          }}
        />
      </span>
    </span>
  );
  if (isLabelHidden) return pill;
  return (
    <span className={styles.root}>
      <FieldLabel as="text" id={labelId} label={label} />
      {pill}
    </span>
  );
}
