import { TOUCH_TARGET } from '../../atoms/Button/touch-target.ts';
import { MonthTiles, type MonthTilesProps } from './MonthTiles.tsx';
import styles from './MonthTilesPlain.module.css';

const LOOK = { ...styles, touchTarget: TOUCH_TARGET };

/**
 * MonthTiles as a compact month of plain numbers in 36px rows, as checklabs' reservation calendar draws it: an open day
 * is plain text that fills under the pointer, today has a hairline ring, and the chosen day fills with the accent (a
 * restaurant's reservation page). Apart from MonthTiles so its styles load only where it is drawn.
 */
export function MonthTilesPlain(props: Omit<MonthTilesProps, 'look'>) {
  return <MonthTiles {...props} look={LOOK} />;
}
