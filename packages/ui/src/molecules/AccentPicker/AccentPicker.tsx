import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton, RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import '../../lib/custom-properties.ts';
import { Field } from '../Field/Field.tsx';
import { strings as hueNames } from '../HuePicker/strings.ts';
import styles from './AccentPicker.module.css';
import { strings } from './strings.ts';

/** A colour as the picker takes and gives it: `#` and six lowercase hex digits. */
const HEX = /^#[0-9a-f]{6}$/;

/**
 * The tick drawn on a swatch of `hex`: black on a light colour, white on a dark one, whichever reads better (WCAG
 * relative luminance against the 0.179 crossover), so a pale yellow still shows that it is chosen.
 */
function markOn(hex: string | undefined): string | undefined {
  if (hex === undefined || !HEX.test(hex)) return undefined;
  const n = Number.parseInt(hex.slice(1), 16);
  const linear = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

/** One quick pick: a hue of the library's nine, and the colour it stands for. */
export interface AccentQuickPick {
  readonly hue: Hue;
  /** A checked hex (`#` and six lowercase digits); anything else is left out. */
  readonly value: string;
}

/** Props for AccentPicker. */
export interface AccentPickerProps {
  /** What the colour is for ("Colour"): the group's name, shown over it. */
  readonly label: string;
  /** Keeps `label` for screen readers only, where a row's title beside the picker already says it. */
  readonly isLabelHidden?: boolean;
  /** The colour picked, or undefined for the default. */
  readonly value?: string;
  /** A colour picked, or undefined to go back to the default. Called once a pick settles. */
  readonly onChange: (value: string | undefined) => void;
  /** While the system picker is dragged: the colour under the pointer, to preview before it settles. */
  readonly onPreview?: (value: string) => void;
  /** What the default is called ("Workspace", "Timefix"): the first swatch's name. */
  readonly defaultName: string;
  /** The colour the default draws, when it is one (the workspace's); undefined draws the product's own accent. */
  readonly defaultValue?: string;
  /** The quick picks, after the default: the nine hues, or as many as the caller offers. */
  readonly quickPicks: readonly AccentQuickPick[];
  /**
   * The colours the page draws, when the contrast guard moved the pick noticeably (spec 0060, AC-6): two swatches
   * and one line say so. Left out when the pick is drawn as it is.
   */
  readonly drawn?: { readonly light: string; readonly dark: string };
  /** Shows the colour without letting it change (a member who may not edit the brand kit). */
  readonly isReadOnly?: boolean;
  readonly isDisabled?: boolean;
  /** Under the hex, on the picker's own left edge: a Disclosure with a second colour (a dark one, under More). */
  readonly children?: ReactNode;
}

/** The radio value of the default swatch, beside the picks' own hexes. */
const DEFAULT = 'default';

/**
 * Any colour, picked by sight (spec 0060, AC-3): the default first, the library's hues as quick picks, then any
 * colour through the system's own picker, with the hex beside them for a brand's exact value. When the contrast
 * guard moved a pick noticeably it says so in one line, beside the colours it draws (AC-6). A radio group, so the
 * arrow keys move between the swatches, as HuePicker's do.
 */
export function AccentPicker({
  label,
  isLabelHidden = false,
  value,
  onChange,
  onPreview,
  defaultName,
  defaultValue,
  quickPicks,
  drawn,
  isReadOnly = false,
  isDisabled = false,
  children,
}: AccentPickerProps) {
  const picks = quickPicks.filter((pick) => HEX.test(pick.value));
  const picked = value !== undefined && HEX.test(value) ? value : undefined;
  const isQuick = picked !== undefined && picks.some((pick) => pick.value === picked);
  // A colour that is neither the default nor a quick pick is Any colour's, which stands outside the group.
  const selected = picked === undefined ? DEFAULT : isQuick ? picked : null;
  const isAny = picked !== undefined && !isQuick;
  // The hex as typed, until it is a colour; a pick from anywhere else replaces it.
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const native = useRef<HTMLInputElement>(null);
  const labelId = useId();
  // The system picker says `input` while it is dragged and `change` once it closes: preview the one, keep the other.
  const settle = useRef(onChange);
  useEffect(() => {
    settle.current = onChange;
  });
  useEffect(() => {
    const input = native.current;
    if (input === null) return undefined;
    const done = () => {
      settle.current(input.value.toLowerCase());
    };
    input.addEventListener('change', done);
    return () => input.removeEventListener('change', done);
  }, []);
  // The system picker opens on the colour shown; it is left uncontrolled so a drag is never put back mid way.
  useEffect(() => {
    const input = native.current;
    const shown = picked ?? defaultValue;
    if (input !== null && shown !== undefined && HEX.test(shown)) input.value = shown;
  }, [picked, defaultValue]);
  const commitTyped = () => {
    if (typed === undefined) return;
    const next = typed.trim().toLowerCase();
    const hex = /^#?[0-9a-f]{6}$/.test(next) ? (next.startsWith('#') ? next : `#${next}`) : undefined;
    if (next === '') {
      setTyped(undefined);
      setRefused(false);
      onChange(undefined);
    } else if (hex === undefined) setRefused(true);
    else {
      setTyped(undefined);
      setRefused(false);
      if (hex !== picked) onChange(hex);
    }
  };
  const heading = isLabelHidden ? (
    <VisuallyHidden>
      <span id={labelId}>{label}</span>
    </VisuallyHidden>
  ) : (
    <span id={labelId} className={styles.label}>
      {label}
    </span>
  );
  const note = drawn !== undefined && HEX.test(drawn.light) && HEX.test(drawn.dark) && (
    <p className={styles.note} role="status">
      <span
        className={styles.drawn}
        role="img"
        aria-label={strings.drawnLight(drawn.light)}
        style={{ '--swatch': drawn.light }}
      />
      <span
        className={styles.drawn}
        role="img"
        aria-label={strings.drawnDark(drawn.dark)}
        style={{ '--swatch': drawn.dark }}
      />
      {strings.adjusted}
    </p>
  );
  if (isReadOnly) {
    // Read only (a member who may not change the kit): the colour as plain text beside its swatch, with no control
    // that looks or announces as one it isn't. The screen says who may change it.
    const quick = picks.find((pick) => pick.value === picked);
    const name = picked === undefined ? defaultName : quick === undefined ? picked : strings.pick(hueNames[quick.hue]);
    const shown = picked ?? (defaultValue !== undefined && HEX.test(defaultValue) ? defaultValue : undefined);
    return (
      <div className={styles.root}>
        {heading}
        <p className={styles.current} aria-labelledby={labelId}>
          <span
            className={styles.drawn}
            data-default={shown === undefined || undefined}
            style={{ '--swatch': shown }}
          />
          <span>{quick === undefined || picked === undefined ? name : strings.named(name, picked)}</span>
        </p>
        {note}
        {children}
      </div>
    );
  }
  return (
    <div className={styles.root}>
      {isLabelHidden ? (
        <VisuallyHidden>
          <span id={labelId}>{label}</span>
        </VisuallyHidden>
      ) : (
        <span id={labelId} className={styles.label}>
          {label}
        </span>
      )}
      <div className={styles.row}>
        <RadioGroup
          className={styles.swatches}
          aria-labelledby={labelId}
          orientation="horizontal"
          value={selected}
          isDisabled={isDisabled}
          onChange={(next) => {
            setTyped(undefined);
            setRefused(false);
            onChange(next === DEFAULT ? undefined : next);
          }}
        >
          <RadioField value={DEFAULT} aria-label={defaultName} className={styles.field}>
            <Tooltip content={defaultName}>
              <RadioButton
                className={styles.swatch}
                data-default=""
                style={{
                  '--swatch': defaultValue !== undefined && HEX.test(defaultValue) ? defaultValue : undefined,
                  '--swatch-mark': markOn(defaultValue),
                }}
              >
                {({ isSelected }) => isSelected && <Icon name="check" size="xs" />}
              </RadioButton>
            </Tooltip>
          </RadioField>
          {picks.map((pick) => (
            <RadioField
              key={pick.hue}
              value={pick.value}
              aria-label={strings.pick(hueNames[pick.hue])}
              className={styles.field}
            >
              <Tooltip content={hueNames[pick.hue]}>
                <RadioButton
                  className={styles.swatch}
                  style={{ '--swatch': pick.value, '--swatch-mark': markOn(pick.value) }}
                >
                  {({ isSelected }) => isSelected && <Icon name="check" size="xs" />}
                </RadioButton>
              </Tooltip>
            </RadioField>
          ))}
        </RadioGroup>
        {/* Any colour: a button rather than one more radio, so the arrow keys never open the system picker on the
          way past. It wears the colour once it holds one. */}
        <Tooltip content={strings.anyColour}>
          <AriaButton
            className={styles.swatch}
            data-any=""
            data-selected={isAny || undefined}
            aria-label={strings.anyColour}
            isDisabled={isDisabled}
            style={{ '--swatch': isAny ? picked : undefined, '--swatch-mark': isAny ? markOn(picked) : undefined }}
            onPress={() => {
              const input = native.current;
              if (input === null) return;
              if (typeof input.showPicker === 'function') input.showPicker();
              else input.click();
            }}
          >
            <Icon name={isAny ? 'check' : 'plus'} size="xs" />
          </AriaButton>
        </Tooltip>
      </div>
      {/* The system's own picker, opened by Any colour: out of sight and out of the tab order, since the swatch and
          the hex field already reach every colour from the keyboard. */}
      <input
        ref={native}
        className={styles.native}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        defaultValue={picked ?? defaultValue ?? strings.hexPlaceholder}
        disabled={isDisabled}
        onChange={(event) => {
          onPreview?.(event.target.value.toLowerCase());
        }}
      />
      <div className={styles.hex}>
        <Field
          label={strings.hex}
          isLabelHidden
          value={typed ?? picked ?? ''}
          placeholder={strings.hexPlaceholder}
          maxLength={7}
          isDisabled={isDisabled}
          {...(refused ? { error: strings.hexRefusal } : {})}
          onChange={(next) => {
            setTyped(next);
            setRefused(false);
          }}
          onBlur={commitTyped}
          onSubmit={commitTyped}
        />
      </div>
      {note}
      {children}
    </div>
  );
}
