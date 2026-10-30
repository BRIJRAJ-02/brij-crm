import { useId, type ReactNode } from 'react';
import { Button as AriaButton, RadioButton, RadioField, RadioGroup, Text } from 'react-aria-components';
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
        {...(tile.description === undefined ? {} : { 'aria-describedby': descriptionId })}
      >
        <Picture tile={tile} />
        <span className={styles.name}>{tile.name}</span>
        {tile.description !== undefined && <VisuallyHidden id={descriptionId}>{tile.description}</VisuallyHidden>}
      </AriaButton>
    </WithTip>
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
          <RadioField
            className={styles.tile}
            data-tile=""
            data-mode="select"
            value={tile.id}
            isDisabled={tile.isDisabled === true}
          >
            <RadioButton className={styles.button}>
              <Picture tile={tile} />
              <span className={styles.name}>{tile.name}</span>
              <span className={styles.tick} aria-hidden="true">
                <Icon name="check" size="sm" />
              </span>
            </RadioButton>
            {tile.description !== undefined && (
              <Text slot="description">
                <VisuallyHidden>{tile.description}</VisuallyHidden>
              </Text>
            )}
          </RadioField>
        </WithTip>
      ))}
    </RadioGroup>
  );
}
