// Brief
// Purpose: one schedule's actions (spec 0035, AC-962, AC-964, AC-967), the same on its row in Availability and in its editor's bar.
// Main task: Set as default, Duplicate, or Delete (which asks first, in the screen's confirm).
// Leaves out: renaming and the hours (the editor), and the virtual default, which has no actions until it is saved.
import type { ScheduleView } from '@crm/data';
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger } from '@crm/ui';
import { scheduleStrings } from './schedule-strings.ts';

/** Props for ScheduleMenu. */
export interface ScheduleMenuProps {
  readonly schedule: ScheduleView;
  /** The member holds as many schedules as they may: Duplicate waits, and says why. */
  readonly isFull: boolean;
  readonly isDisabled?: boolean;
  readonly onSetDefault: () => void;
  readonly onDuplicate: () => void;
  /** Opens the screen's delete confirm. */
  readonly onDelete: () => void;
}

/**
 * The ··· button and its menu. An item the schedule can't take stays, disabled, with its reason as its second line:
 * the default is already the default and can't be deleted; a full list can't take a copy.
 */
export function ScheduleMenu({
  schedule,
  isFull,
  isDisabled = false,
  onSetDefault,
  onDuplicate,
  onDelete,
}: ScheduleMenuProps) {
  const disabled = [...(schedule.isDefault ? ['default', 'delete'] : []), ...(isFull ? ['duplicate'] : [])];
  return (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={scheduleStrings.more(schedule.name)} isDisabled={isDisabled} />
      <Menu
        label={scheduleStrings.more(schedule.name)}
        disabledKeys={disabled}
        onAction={(key) => {
          if (key === 'default') onSetDefault();
          if (key === 'duplicate') onDuplicate();
          if (key === 'delete') onDelete();
        }}
      >
        <MenuItem
          id="default"
          icon="star"
          {...(schedule.isDefault ? { description: scheduleStrings.alreadyDefault } : {})}
        >
          {scheduleStrings.setDefault}
        </MenuItem>
        <MenuItem id="duplicate" icon="copy" {...(isFull ? { description: scheduleStrings.limitReached } : {})}>
          {scheduleStrings.duplicate}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          id="delete"
          icon="trash"
          isDanger
          {...(schedule.isDefault ? { description: scheduleStrings.cantDeleteDefault } : {})}
        >
          {scheduleStrings.delete}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
