// A column's calculation in the grid's footer (the CRM flow pass): a quiet
// "+ Calculate" that shows on hover or keyboard focus, opening a Menu of what
// the column's type can work out; once chosen, its name and value ("Sum
// $42,300") in its place. The screen works the value out across every
// matching record (`records.aggregate`); the grid never adds up loaded rows.
import type { AggregateFn } from '@crm/contracts/values';
import { Button } from '../../atoms/Button/Button.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import styles from './GridCalc.module.css';
import { strings } from './strings.ts';

/** One column's calculation: what its type can work out, the one chosen, and its value once worked out. */
export interface ColumnCalc {
  /** What the column's type offers, in menu order (`aggregatesFor`). */
  readonly choices: readonly AggregateFn[];
  readonly chosen?: AggregateFn;
  /** The value, formatted by the screen ("$42,300", "1,204"); undefined while it is worked out. */
  readonly value?: string;
  /** A new choice, or undefined to show none. */
  readonly onChange: (fn: AggregateFn | undefined) => void;
}

/** Menu keys: the choices are the fns themselves; "None" can't be one. */
const NONE = '\u0000none';

/** The footer's calculation for one column, its menu opened by a press or, from the grid, by Enter on its cell. */
export function GridCalc({
  name,
  calc,
  isActive,
  isOpen,
  onOpenChange,
}: {
  /** The column's name, for the menu's label. */
  readonly name: string;
  readonly calc: ColumnCalc;
  /** The grid's focus is on this footer cell: the quiet trigger shows. */
  readonly isActive: boolean;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}) {
  const { chosen } = calc;
  const label =
    chosen === undefined ? strings.calculate : `${strings.calcs[chosen]} ${calc.value ?? strings.calcPending}`;
  return (
    <span className={styles.root} data-empty={chosen === undefined || undefined} data-active={isActive || undefined}>
      <span className={styles.reveal}>
        <MenuTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
          <Button variant="ghost" {...(chosen === undefined ? { icon: 'plus' as const } : {})} tooltipWhenCut>
            {label}
          </Button>
          <Menu<object>
            label={strings.calculateColumn(name)}
            placement="top start"
            selectionMode="single"
            selectedKeys={chosen === undefined ? [] : [chosen]}
            onAction={(key) => {
              const fn = calc.choices.find((each) => each === key);
              calc.onChange(fn);
            }}
          >
            {calc.choices.map((fn) => (
              <MenuItem key={fn} id={fn}>
                {strings.calcs[fn]}
              </MenuItem>
            ))}
            {chosen !== undefined && <MenuSeparator />}
            {chosen !== undefined && <MenuItem id={NONE}>{strings.calcNone}</MenuItem>}
          </Menu>
        </MenuTrigger>
      </span>
    </span>
  );
}
