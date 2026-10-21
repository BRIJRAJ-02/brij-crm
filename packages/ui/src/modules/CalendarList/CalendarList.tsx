import { Badge } from '../../atoms/Badge/Badge.tsx';
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
  /** New bookings go here. */
  readonly isDefault: boolean;
  /** It can take bookings (the member can write it): Make default is offered. */
  readonly canBeDefault: boolean;
}

/** One account with its calendars. */
export interface CalendarListAccount {
  readonly id: string;
  readonly provider: ProviderName;
  /** The account's address, its heading. */
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
  /** Make default: new bookings go to this calendar. Left out, nobody may move it. */
  readonly onMakeDefault?: (calendarId: string) => void;
}

/**
 * The member's calendars by account, as Google Calendar lists them beside its grid: each account a fold headed by
 * its provider's mark and address, each calendar a checkbox in its own colour with its name, Default on the one new
 * bookings go to, and its own options button (Show only this, Make default). Show all follows the list while any
 * calendar is hidden.
 */
export function CalendarList({ accounts, onShownChange, onShowOnly, onShowAll, onMakeDefault }: CalendarListProps) {
  const anyHidden = accounts.some((account) => account.calendars.some((calendar) => !calendar.isShown));
  const shownCount = accounts.reduce(
    (sum, account) => sum + account.calendars.filter((each) => each.isShown).length,
    0,
  );
  return (
    <div className={styles.root}>
      {accounts.map((account) => (
        <Disclosure
          key={account.id}
          title={account.email}
          leading={<ProviderMark provider={account.provider} size="sm" />}
          variant="label"
          defaultExpanded
        >
          <ul className={styles.list}>
            {account.calendars.map((calendar) => (
              <li key={calendar.id} className={styles.row}>
                <span className={styles.check}>
                  <Checkbox
                    label={calendar.name}
                    hue={calendar.hue}
                    isSelected={calendar.isShown}
                    onChange={(isShown) => onShownChange(calendar.id, isShown)}
                  />
                </span>
                {calendar.isDefault && <Badge text={strings.default} label={strings.defaultName} />}
                <MenuTrigger>
                  <Button variant="ghost" size="sm" icon="ellipsis" label={strings.options(calendar.name)} />
                  <Menu
                    label={strings.options(calendar.name)}
                    onAction={(key) => {
                      if (key === 'only') onShowOnly(calendar.id);
                      if (key === 'default') onMakeDefault?.(calendar.id);
                    }}
                  >
                    {calendar.isShown && shownCount === 1 ? null : (
                      <MenuItem id="only" icon="eye">
                        {strings.showOnly}
                      </MenuItem>
                    )}
                    {onMakeDefault !== undefined && calendar.canBeDefault && !calendar.isDefault ? (
                      <MenuItem id="default" icon="calendar-check">
                        {strings.makeDefault}
                      </MenuItem>
                    ) : null}
                  </Menu>
                </MenuTrigger>
              </li>
            ))}
          </ul>
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
