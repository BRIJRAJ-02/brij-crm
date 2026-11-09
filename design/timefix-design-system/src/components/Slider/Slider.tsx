import { Slider as AriaSlider, type SliderProps as AriaSliderProps, Label, SliderOutput, SliderTrack, SliderThumb } from 'react-aria-components';
import type { CSSProperties } from 'react';
import { cx } from '../../lib/cx.ts';
import './Slider.css';

/** A labelled stop under the track ("12h"). */
export interface SliderTick {
  readonly value: number;
  readonly label?: string;
}

/** Props for Slider. Pass a number for one thumb or `[from, to]` for a range. */
export interface SliderProps<T extends number | number[]> extends Omit<AriaSliderProps<T>, 'children' | 'className'> {
  readonly label: string;
  /** Shows the value (or "from – to") at the end of the label row. On by default. */
  readonly showOutput?: boolean;
  /** Marks under the track; give labels to the few that orient (start, middle, end). */
  readonly ticks?: readonly SliderTick[];
  /** Names each thumb of a range for screen readers. */
  readonly thumbLabels?: readonly [string, string];
  readonly className?: string;
}

/** A value, or a from–to range, picked along a track by drag or arrows; a bubble shows the value while it moves. */
export function Slider<T extends number | number[]>({ label, showOutput = true, ticks, thumbLabels = ['From', 'To'], className, ...rest }: SliderProps<T>) {
  const min = rest.minValue ?? 0;
  const max = rest.maxValue ?? 100;
  const pct = (v: number) => ((v - min) / (max - min || 1)) * 100;
  return (
    <AriaSlider {...rest} className={cx('tf-slider', className)}>
      <div className="tf-slider__head">
        <Label className="tf-slider__label">{label}</Label>
        {showOutput && <SliderOutput className="tf-slider__output" />}
      </div>
      <SliderTrack className="tf-slider__track">
        {({ state }) => {
          const range = state.values.length > 1;
          const from = range ? state.getThumbPercent(0) * 100 : 0;
          const to = state.getThumbPercent(range ? 1 : 0) * 100;
          return (
            <>
              <span className="tf-slider__rail" aria-hidden="true" />
              <span className="tf-slider__fill" aria-hidden="true" data-from-start={!range || undefined} style={{ left: `${from}%`, width: `${to - from}%` }} />
              {ticks?.map((t) => (
                <span key={t.value} className="tf-slider__tick" aria-hidden="true" data-on={(pct(t.value) >= from && pct(t.value) <= to) || undefined} style={{ '--tf-tick': `${pct(t.value)}%` } as CSSProperties} />
              ))}
              {state.values.map((_, i) => (
                <SliderThumb key={i} index={i} className="tf-slider__thumb" aria-label={range ? thumbLabels[i] : undefined}>
                  <span className="tf-slider__bubble" aria-hidden="true">{state.getThumbValueLabel(i)}</span>
                </SliderThumb>
              ))}
            </>
          );
        }}
      </SliderTrack>
      {ticks?.some((t) => t.label) && (
        <div className="tf-slider__scale" aria-hidden="true">
          {ticks.filter((t) => t.label).map((t) => (
            <span key={t.value} className="tf-slider__mark" data-edge={pct(t.value) <= 0 ? 'start' : pct(t.value) >= 100 ? 'end' : undefined} style={{ '--tf-tick': `${pct(t.value)}%` } as CSSProperties}>{t.label}</span>
          ))}
        </div>
      )}
    </AriaSlider>
  );
}
