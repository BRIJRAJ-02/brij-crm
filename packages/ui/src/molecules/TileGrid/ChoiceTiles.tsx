import { useContext, useId, useRef, type ReactNode } from 'react';
import { mergeProps, useFocusRing, useHover, useRadio } from 'react-aria';
import { Button as AriaButton, RadioGroup, RadioGroupStateContext } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import styles from './ChoiceTiles.module.css';

/** One tile in a choice grid. */
export interface ChoiceTile {
  /** What picking it returns. */
  readonly id: string;
  /** Its name: one or two words, under the picture. It is the tile's accessible name. */
  readonly name: string;
  /** A Lucide mark drawn large in the picture slot. Use this or `thumbnail`. */
  readonly icon?: IconName;
  /** A small picture of the real thing (a preset's look, an embed's placement). Decoration: hidden from screen readers. */
  readonly thumbnail?: ReactNode;
  /** A sentence about it, shown as a tooltip and read by screen readers as its description. */
  readonly description?: string;
  readonly isDisabled?: boolean;
  /**
   * Why a disabled tile can't be picked now, in a few words ("At the limit"). It shows on the tile under its name
   * and is the tile's description for screen readers, so the reason never hides behind a tooltip a keyboard can't
   * reach (a disabled tile takes no focus). Ignored on a tile that isn't disabled.
   */
  readonly disabledReason?: string;
}

/** The reason a tile shows, when it is disabled and has one. */
function reasonOf(tile: ChoiceTile): string | undefined {
  return tile.isDisabled === true ? tile.disabledReason : undefined;
}

interface ChoiceTilesBase {
  readonly variant: 'choice';
  /** What the tiles answer ("Block kind"), the group's accessible name. */
  readonly label: string;
  readonly tiles: readonly ChoiceTile[];
}

/** A choice grid that keeps one tile chosen. */
export interface ChoiceSelectProps extends ChoiceTilesBase {
  readonly mode?: 'select';
  /** The chosen tile's `id`; `null` for none yet. */
  readonly value?: string | null;
  readonly defaultValue?: string;
  readonly onChange?: (id: string) => void;
}

/** A choice grid whose tiles each start something at once (a block kind adds that block). */
export interface ChoiceActionProps extends ChoiceTilesBase {
  readonly mode: 'action';
  readonly onAction: (id: string) => void;
}

/** Props for the choice variant of TileGrid. */
export type ChoiceTilesProps = ChoiceSelectProps | ChoiceActionProps;

function Picture({ tile }: { readonly tile: ChoiceTile }) {
  return (
    <span className={styles.picture} aria-hidden="true" data-kind={tile.thumbnail === undefined ? 'icon' : 'thumbnail'}>
      {tile.thumbnail ?? (tile.icon !== undefined && <Icon name={tile.icon} size="md" />)}
    </span>
  );
}

/** Wraps a tile in its tooltip when it has a description; the tile stays the grid cell's whole size. */
function WithTip({ tile, children }: { readonly tile: ChoiceTile; readonly children: ReactNode }) {
  if (tile.description === undefined) return children;
  return (
    <Tooltip content={tile.description} isTextTrigger>
      <span className={styles.cell}>{children}</span>
    </Tooltip>
  );
}

function ActionTile({ tile, onAction }: { readonly tile: ChoiceTile; readonly onAction: (id: string) => void }) {
  const descriptionId = useId();
  const reasonId = useId();
  const reason = reasonOf(tile);
  const describedBy = [
    ...(tile.description === undefined ? [] : [descriptionId]),
    ...(reason === undefined ? [] : [reasonId]),
  ].join(' ');
  return (
    <WithTip tile={tile}>
      <AriaButton
        className={styles.tile}
        data-tile=""
        data-mode="action"
        isDisabled={tile.isDisabled === true}
        onPress={() => {
          onAction(tile.id);
        }}
        {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
      >
        <Picture tile={tile} />
        <span className={styles.name}>{tile.name}</span>
        {reason !== undefined && (
          <span id={reasonId} className={styles.reason}>
            {reason}
          </span>
        )}
        {tile.description !== undefined && <VisuallyHidden id={descriptionId}>{tile.description}</VisuallyHidden>}
      </AriaButton>
    </WithTip>
  );
}

/**
 * One tile of a select grid. The tile is the radio's label, and the radio itself is a real input laid, unseen, over
 * the tick's corner, so a click anywhere on the tile, on its name, or on the radio picks it, and nothing covers the
 * radio (React Aria's own RadioButton clips its input to nothing, which only a forced click reaches).
 */
function SelectTile({ tile }: { readonly tile: ChoiceTile }) {
  const state = useContext(RadioGroupStateContext);
  if (state === null) throw new Error('A select tile renders inside its RadioGroup.');
  const inputRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const reason = reasonOf(tile);
  const describedBy = [
    ...(reason === undefined ? [] : [reasonId]),
    ...(tile.description === undefined ? [] : [descriptionId]),
  ].join(' ');
  const { inputProps, labelProps, isSelected, isDisabled, isPressed } = useRadio(
    {
      value: tile.id,
      isDisabled: tile.isDisabled === true,
      'aria-labelledby': nameId,
      ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    },
    state,
    inputRef,
  );
  const { focusProps, isFocusVisible } = useFocusRing();
  const { hoverProps, isHovered } = useHover({ isDisabled });
  return (
    <label
      {...mergeProps(labelProps, hoverProps)}
      className={styles.tile}
      data-tile=""
      data-mode="select"
      data-selected={isSelected || undefined}
      data-disabled={isDisabled || undefined}
      data-pressed={isPressed || undefined}
      data-hovered={isHovered || undefined}
      data-focus-visible={isFocusVisible || undefined}
    >
      <input {...mergeProps(inputProps, focusProps)} ref={inputRef} className={styles.input} />
      <Picture tile={tile} />
      <span id={nameId} className={styles.name}>
        {tile.name}
      </span>
      {reason !== undefined && (
        <span id={reasonId} className={styles.reason}>
          {reason}
        </span>
      )}
      {tile.description !== undefined && <VisuallyHidden id={descriptionId}>{tile.description}</VisuallyHidden>}
      <span className={styles.tick} aria-hidden="true">
        <Icon name="check" size="sm" />
      </span>
    </label>
  );
}

/**
 * Equal size tiles to pick from by sight: a picture slot (a Lucide mark or a thumbnail), a short name, and for
 * `select` a ring and a tick on the chosen one. `select` is a radio group (one tab stop, arrows move and pick);
 * `action` is a group of buttons. Internal: reached through `TileGrid variant="choice"`.
 */
export function ChoiceTiles(props: ChoiceTilesProps) {
  if (props.mode === 'action') {
    const { label, tiles, onAction } = props;
    return (
      <div className={styles.root} role="group" aria-label={label}>
        {tiles.map((tile) => (
          <ActionTile key={tile.id} tile={tile} onAction={onAction} />
        ))}
      </div>
    );
  }
  const { label, tiles, value, defaultValue, onChange } = props;
  return (
    <RadioGroup
      className={styles.root}
      aria-label={label}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange })}
    >
      {tiles.map((tile) => (
        <WithTip key={tile.id} tile={tile}>
          <SelectTile tile={tile} />
        </WithTip>
      ))}
    </RadioGroup>
  );
}
