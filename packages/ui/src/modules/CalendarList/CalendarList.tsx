import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { ProviderMark, type ProviderName } from '../../atoms/ProviderMark/ProviderMark.tsx';
import type { Hue } from '../../hue.ts';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import styles from './CalendarList.module.css';
import { strings } from './strings.ts';

/** One calendar in the list. */
export interface CalendarListCalendar {
  readonly id: string;
  readonly name: string;
  readonly hue: Hue;
  /** Its events show on the view. */
  readonly isShown: boolean;
}

/** One account with its calendars. */
export interface CalendarListAccount {
  readonly id: string;
  readonly provider: ProviderName;
  /** The account's address, its heading when it holds two or more calendars. */
  readonly email: string;
  readonly calendars: readonly CalendarListCalendar[];
}

/** Props for CalendarList. */
export interface CalendarListProps {
  readonly accounts: readonly CalendarListAccount[];
  /** A calendar's box checked or cleared. */
  readonly onShownChange: (calendarId: string, isShown: boolean) => void;
  /** Show only this: the one calendar alone. */
  readonly onShowOnly: (calendarId: string) => void;
  /** Show all: every calendar again. Offered while any is hidden. */
  readonly onShowAll: () => void;
  /** The list's small label over the calendars. Default "My calendars". */
  readonly label?: string;
}

/** One calendar's row: its box in its colour, its name, and its options, shown on hover or focus. */
function Row({
  calendar,
  shownCount,
  onShownChange,
  onShowOnly,
}: {
  readonly calendar: CalendarListCalendar;
  readonly shownCount: number;
  readonly onShownChange: CalendarListProps['onShownChange'];
  readonly onShowOnly: CalendarListProps['onShowOnly'];
}) {
  const canShowOnly = !(calendar.isShown && shownCount === 1);
  return (
    <li className={styles.row}>
      <span className={styles.check}>
        <Checkbox
          label={calendar.name}
          hue={calendar.hue}
          isSelected={calendar.isShown}
          onChange={(isShown) => onShownChange(calendar.id, isShown)}
        />
      </span>
      {canShowOnly && (
        <span className={styles.options}>
          <MenuTrigger>
            <Button variant="ghost" size="sm" icon="ellipsis" label={strings.options(calendar.name)} />
            <Menu
              label={strings.options(calendar.name)}
              onAction={(key) => {
                if (key === 'only') onShowOnly(calendar.id);
              }}
            >
              <MenuItem id="only" icon="eye">
                {strings.showOnly}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </span>
      )}
    </li>
  );
}

/**
 * The member's calendars, as Google Calendar lists them beside its grid: a small label, then each calendar a
 * checkbox filled with its own colour and its name. An account with one calendar is that one row; an account with
 * two or more folds under its provider's mark and address. Each row's options (Show only this) show on hover or
 * focus, and always on touch. Show all follows the list while any calendar is hidden. Which calendar takes new
 * bookings is a setting, so it lives in Settings, not here.
 */
export function CalendarList({ accounts, onShownChange, onShowOnly, onShowAll, label }: CalendarListProps) {
  const anyHidden = accounts.some((account) => account.calendars.some((calendar) => !calendar.isShown));
  const shownCount = accounts.reduce(
    (sum, account) => sum + account.calendars.filter((each) => each.isShown).length,
    0,
  );
  const singles = accounts.filter((account) => account.calendars.length === 1);
  const groups = accounts.filter((account) => account.calendars.length > 1);
  const row = (calendar: CalendarListCalendar) => (
    <Row
      key={calendar.id}
      calendar={calendar}
      shownCount={shownCount}
      onShownChange={onShownChange}
      onShowOnly={onShowOnly}
    />
  );
  return (
    <div className={styles.root}>
      <h2 className={styles.label}>{label ?? strings.label}</h2>
      {singles.length > 0 && (
        <ul className={styles.list}>{singles.flatMap((account) => account.calendars.map(row))}</ul>
      )}
      {groups.map((account) => (
        <Disclosure
          key={account.id}
          title={account.email}
          leading={<ProviderMark provider={account.provider} size="sm" />}
          variant="label"
          defaultExpanded
        >
          <ul className={styles.list}>{account.calendars.map(row)}</ul>
        </Disclosure>
      ))}
      {/* At the end, so the rows never move under the pointer when it comes and goes. */}
      {anyHidden && (
        <div className={styles.foot}>
          <Button variant="ghost" size="sm" onPress={onShowAll}>
            {strings.showAll}
          </Button>
        </div>
      )}
    </div>
  );
}
