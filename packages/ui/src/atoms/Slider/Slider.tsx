import { Label, Slider as AriaSlider, SliderFill, SliderOutput, SliderThumb, SliderTrack } from 'react-aria-components';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './Slider.module.css';

/** Props for Slider. */
export interface SliderProps {
  /** What it sets, in sentence case ("Zoom"). */
  readonly label: string;
  /** Read by screen readers only, where the slider's place names it (beside a photo's minus and plus). */
  readonly isLabelHidden?: boolean;
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** Called once the person lets go, or after a key: for a change that is saved rather than shown. */
  readonly onChangeEnd?: (value: number) => void;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly step?: number;
  /** How the value reads, to screen readers and beside the label (`{ style: 'percent' }` for a zoom). */
  readonly formatOptions?: Intl.NumberFormatOptions;
  /** Draws the value beside the label. */
  readonly showsValue?: boolean;
  readonly isDisabled?: boolean;
}

/**
 * Picks one number along a track: a photo's zoom. Built on React Aria's Slider, so it is a real slider to a screen
 * reader, and the arrows step it, Page Up and Page Down step it further, and Home and End go to its ends.
 */
export function Slider({
  label,
  isLabelHidden = false,
  value,
  onChange,
  onChangeEnd,
  minValue = 0,
  maxValue = 100,
  step = 1,
  formatOptions,
  showsValue = false,
  isDisabled = false,
}: SliderProps) {
  return (
    <AriaSlider
      className={styles.root}
      value={value}
      onChange={onChange}
      {...(onChangeEnd === undefined ? {} : { onChangeEnd })}
      minValue={minValue}
      maxValue={maxValue}
      step={step}
      {...(formatOptions === undefined ? {} : { formatOptions })}
      isDisabled={isDisabled}
    >
      {isLabelHidden ? (
        <VisuallyHidden>
          <Label>{label}</Label>
        </VisuallyHidden>
      ) : (
        <span className={styles.head}>
          <Label className={styles.label}>{label}</Label>
          {showsValue && <SliderOutput className={styles.value} />}
        </span>
      )}
      <SliderTrack className={styles.track}>
        <span className={styles.rail} aria-hidden="true">
          <SliderFill className={styles.fill} />
        </span>
        <SliderThumb className={styles.thumb}>
          {/* The value bubble over the thumb (the prototype's, transitions.dev 17): for sight, while hovered, dragged
              or focused. The thumb's own input already tells a screen reader its value. */}
          <SliderOutput className={styles.bubble} aria-hidden="true" />
        </SliderThumb>
      </SliderTrack>
    </AriaSlider>
  );
}
