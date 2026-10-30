import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusVisible } from 'react-aria';
import { RadioButton, RadioField, RadioGroup, SelectionIndicator } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { keyShortcuts } from '../../atoms/Kbd/shortcuts.ts';
import { useKeyboardPlatform } from '../../provider/context.ts';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import type { Hue } from '../../hue.ts';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { ThemeChoice, ThemeController } from '../../theme/theme.ts';
import styles from './SegmentedControl.module.css';
import { strings } from './strings.ts';

/** One segment. */
export interface Segment {
  readonly value: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Shows the icon alone; the label stays its name. */
  readonly isIconOnly?: boolean;
  /** A colour dot before the label (a calendar's colour on Bookings' week), drawn as the StatusDot atom. */
  readonly hue?: Hue;
  /**
   * The key that picks it from anywhere on the page (Bookings' D and W), written with Mac symbols: stated to screen
   * readers as `aria-keyshortcuts`. The screen handles the key and lists it in its shortcut help.
   */
  readonly kbd?: string;
}

/** Props for SegmentedControl. */
export interface SegmentedControlProps {
  /** What it switches ("View"). Read by screen readers, and shown above the track with `isLabelVisible`. */
  readonly label: string;
  /** Two to five segments. */
  readonly segments: readonly Segment[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  readonly isDisabled?: boolean;
  /** Shows the choice at full contrast and keeps it focusable, but it can't be changed (a viewer of a saved choice). */
  readonly isReadOnly?: boolean;
  /**
   * `horizontal` (the default) puts the segments in a row; `vertical` stacks
   * them, for a column too narrow for the row: icon only segments in the
   * folded sidebar's rail. The arrow keys move either way.
   */
  readonly orientation?: SegmentOrientation;
  /**
   * `md` (the default) sits on its own; `compact` is exactly a button's
   * `size-control` tall, track and all, so it lines up with the buttons
   * beside it in a bar: the view bar's Table and Board.
   */
  readonly size?: SegmentSize;
  /**
   * In a narrow bar (its container under 480px, a phone) the segments that
   * have an icon show it alone; the label stays each one's name.
   */
  readonly isLabelCollapsible?: boolean;
  /**
   * Shows `label` above the track, as a Field's label, for a choice inside a
   * short form (a new booking page's Duration).
   */
  readonly isLabelVisible?: boolean;
  /**
   * Each segment as wide as its words, rather than all of them as wide as the
   * widest: a row of names of different lengths (Bookings' calendars), where
   * equal cells left short names in wide empty ones.
   */
  readonly isFitted?: boolean;
}

/** How tall the control is: `compact` matches a button. */
export type SegmentSize = 'md' | 'compact';

/** Which way the segments run. */
export type SegmentOrientation = 'horizontal' | 'vertical';

/**
 * Two to five segments, equal or (`isFitted`) each as wide as its words, that switch how you see something: Table or
 * Board, Week or Month. A radio group underneath, so the arrow keys move. The
 * thumb slides for a pointer and jumps for the keyboard.
 */
export function SegmentedControl({
  label,
  segments,
  value,
  defaultValue,
  onChange,
  isDisabled = false,
  isReadOnly = false,
  orientation = 'horizontal',
  size = 'md',
  isLabelCollapsible = false,
  isLabelVisible = false,
  isFitted = false,
}: SegmentedControlProps) {
  const { isFocusVisible } = useFocusVisible();
  const labelId = useId();
  const platform = useKeyboardPlatform();
  const group = (
    <RadioGroup
      className={styles.root}
      {...(isLabelVisible ? { 'aria-labelledby': labelId } : { 'aria-label': label })}
      orientation={orientation}
      data-orientation={orientation}
      data-size={size}
      data-fitted={isFitted || undefined}
      data-collapsible={isLabelCollapsible || undefined}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      data-instant={isFocusVisible || undefined}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange })}
    >
      {segments.map((segment) => (
        <RadioField
          key={segment.value}
          value={segment.value}
          className={styles.field}
          // React Aria's radio takes no aria-keyshortcuts, so it goes on the input itself.
          {...(segment.kbd === undefined
            ? {}
            : {
                inputRef: (input: HTMLInputElement | null) => {
                  input?.setAttribute('aria-keyshortcuts', keyShortcuts([segment.kbd ?? ''], platform));
                },
              })}
        >
          <RadioButton className={styles.segment}>
            <SelectionIndicator className={styles.thumb} />
            {segment.icon !== undefined &&
              (segment.isIconOnly === true ? (
                // An icon alone says its name on hover too, beside the rail when stacked.
                <Tooltip content={segment.label} isTextTrigger placement={orientation === 'vertical' ? 'end' : 'top'}>
                  <span className={styles.icon}>
                    <Icon name={segment.icon} size="sm" />
                  </span>
                </Tooltip>
              ) : isLabelCollapsible ? (
                <CollapsibleIcon icon={segment.icon} label={segment.label} />
              ) : (
                <span className={styles.icon}>
                  <Icon name={segment.icon} size="sm" />
                </span>
              ))}
            {segment.isIconOnly === true ? (
              <VisuallyHidden>{segment.label}</VisuallyHidden>
            ) : isLabelCollapsible && segment.icon !== undefined ? (
              // The words may hide in a narrow bar, so the name comes from a copy that never does.
              <>
                <span className={styles.label} aria-hidden="true" data-collapsible="">
                  {segment.label}
                </span>
                <VisuallyHidden>{segment.label}</VisuallyHidden>
              </>
            ) : segment.hue === undefined ? (
              <span className={styles.label}>{segment.label}</span>
            ) : (
              <HueLabel label={segment.label} hue={segment.hue} />
            )}
          </RadioButton>
        </RadioField>
      ))}
    </RadioGroup>
  );
  if (!isLabelVisible) return group;
  return (
    <div className={styles.labelled} data-disabled={isDisabled || undefined}>
      <span id={labelId} className={styles.title}>
        {label}
      </span>
      {group}
    </div>
  );
}

/** Props for ThemeSwitch. */
export interface ThemeSwitchProps {
  /** The app's theme controller (`context.theme` in the router). */
  readonly controller: ThemeController;
  /** Icons only, for the sidebar footer. */
  readonly isCompact?: boolean;
  /**
   * `vertical` stacks the three segments, for the folded sidebar's rail,
   * where the row doesn't fit. Pair it with `isCompact`.
   */
  readonly orientation?: SegmentOrientation;
}

/** Light, Dark or System, in the sidebar footer. It reads and sets the app's theme controller, so every tab stays in step. */
export function ThemeSwitch({ controller, isCompact = false, orientation = 'horizontal' }: ThemeSwitchProps) {
  const choice = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.get(),
  );
  const segments: readonly Segment[] = [
    { value: 'light', label: strings.light, icon: 'sun', isIconOnly: isCompact },
    { value: 'dark', label: strings.dark, icon: 'moon', isIconOnly: isCompact },
    { value: 'system', label: strings.system, icon: 'monitor', isIconOnly: isCompact },
  ];
  return (
    <SegmentedControl
      label={strings.theme}
      segments={segments}
      value={choice}
      orientation={orientation}
      onChange={(next) => {
        controller.set(next as ThemeChoice);
      }}
    />
  );
}

/**
 * A collapsible segment's icon: while its label is hidden in a narrow bar (a phone), hovering it names the
 * segment in a tooltip, as an icon only segment does; with the label showing, no tooltip opens.
 */
/**
 * A segment's colour dot and name, cut at its cap with an ellipsis; hovering or focusing a cut name shows it whole
 * in a tooltip (measured as the tooltip is about to open, as TruncatedText does), and a name that fits shows none.
 */
function HueLabel({ label, hue }: { readonly label: string; readonly hue: Hue }) {
  const [isOpen, setOpen] = useState(false);
  const own = useRef<HTMLSpanElement>(null);
  const isCut = () => {
    const words = own.current?.querySelector<HTMLElement>('[data-truncated]');
    return words !== null && words !== undefined && words.scrollWidth > words.clientWidth;
  };
  return (
    <Tooltip
      content={label}
      isTextTrigger
      isOpen={isOpen}
      onOpenChange={(next) => {
        setOpen(next && isCut());
      }}
    >
      <span ref={own} className={styles.label} data-hue="">
        <StatusDot hue={hue} isInherited>
          {label}
        </StatusDot>
      </span>
    </Tooltip>
  );
}

function CollapsibleIcon({ icon, label }: { readonly icon: IconName; readonly label: string }) {
  const [isOpen, setOpen] = useState(false);
  const own = useRef<HTMLSpanElement>(null);
  const isCollapsed = () => {
    const segment = own.current?.closest(`.${styles.segment ?? ''}`);
    const words = segment?.querySelector<HTMLElement>('[data-collapsible]');
    return words !== null && words !== undefined && words.getClientRects().length === 0;
  };
  return (
    <Tooltip
      content={label}
      isTextTrigger
      isOpen={isOpen}
      onOpenChange={(next) => {
        setOpen(next && isCollapsed());
      }}
    >
      <span ref={own} className={styles.icon}>
        <Icon name={icon} size="sm" />
      </span>
    </Tooltip>
  );
}
