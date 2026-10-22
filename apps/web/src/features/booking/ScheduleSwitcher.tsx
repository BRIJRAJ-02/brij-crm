// Brief
// Purpose: the Availability tab's schedule switcher (spec 0035, AC-962, AC-964, AC-967, AC-969): the open schedule's name with its Default badge, and one menu to switch, make, rename, set as default, duplicate or delete.
// Main task: open another schedule, or act on the open one; Delete asks first, in the screen's confirm.
// Leaves out: the hours (the tab's editor), and acting on the virtual default before its first save.
import type { ScheduleView } from '@crm/data';
import type { Ref } from 'react';
import { Badge, Button, Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger, type IconName } from '@crm/ui';
import { scheduleStrings } from './schedule-strings.ts';

/** Props for ScheduleSwitcher. */
export interface ScheduleSwitcherProps {
  /** The member's schedules, the default first. */
  readonly schedules: readonly ScheduleView[];
  /** The one open in the tab. */
  readonly current: ScheduleView;
  /** The member holds as many schedules as they may: New schedule and Duplicate are left out (the TopBar's New says why). */
  readonly isFull: boolean;
  /** Nothing is ready to act on yet (the switcher while the tab loads). */
  readonly isDisabled?: boolean;
  /** The trigger, so the screen can bring focus back to it after a switch remounts the editor. */
  readonly triggerRef?: Ref<HTMLButtonElement>;
  readonly onOpen: (schedule: ScheduleView) => void;
  readonly onCreate: () => void;
  readonly onRename: () => void;
  readonly onSetDefault: () => void;
  readonly onDuplicate: () => void;
  /** Opens the screen's delete confirm. */
  readonly onDelete: () => void;
}

const CREATE = '@create';
const ACT = '@act:';

/** A schedule's key in the menu: its id, or the virtual default's. */
const keyOf = (schedule: ScheduleView) => schedule.id ?? 'default';

/**
 * The open schedule's name as a menu button, with Default beside it. The menu lists the schedules to switch to (the
 * open one checked, the default tagged), New schedule, then this schedule's own actions: Rename, Duplicate, Set as
 * default, Delete. An action that can't apply is left out rather than shown disabled with a reason (the owner, 22
 * October 2026): no Set as default on the default, no Delete on the default or the only schedule, no New schedule or
 * Duplicate once the list is full, and nothing to act on while the schedule isn't saved yet. The headings show only
 * with two or more schedules.
 */
export function ScheduleSwitcher({
  schedules,
  current,
  isFull,
  isDisabled = false,
  triggerRef,
  onOpen,
  onCreate,
  onRename,
  onSetDefault,
  onDuplicate,
  onDelete,
}: ScheduleSwitcherProps) {
  const isVirtual = current.id === null;
  const isPending = !isVirtual && current.updatedAt === null;
  const isSaved = !isVirtual && !isPending;
  const all: readonly {
    readonly id: string;
    readonly icon: IconName;
    readonly label: string;
    readonly isDanger: boolean;
    /** It can apply to this schedule now; otherwise it is left out. */
    readonly applies: boolean;
  }[] = [
    { id: 'rename', icon: 'pencil', label: scheduleStrings.rename, isDanger: false, applies: isSaved },
    { id: 'duplicate', icon: 'copy', label: scheduleStrings.duplicate, isDanger: false, applies: isSaved && !isFull },
    {
      id: 'default',
      icon: 'star',
      label: scheduleStrings.setDefault,
      isDanger: false,
      applies: isSaved && !current.isDefault,
    },
    {
      id: 'delete',
      icon: 'trash',
      label: scheduleStrings.delete,
      isDanger: true,
      applies: isSaved && !current.isDefault && schedules.length > 1,
    },
  ];
  const actions = all.filter((action) => action.applies);
  const hasHeadings = schedules.length > 1;
  // A copy on its way can't be opened until the server made it.
  const disabled = schedules.filter((each) => each.id !== null && each.updatedAt === null).map(keyOf);
  return (
    <>
      <MenuTrigger>
        <Button
          ref={triggerRef}
          variant="ghost"
          iconRight="chevron-down"
          isDisabled={isDisabled}
          label={scheduleStrings.switcherLabel(current.name, current.isDefault)}
        >
          {current.name}
        </Button>
        <Menu
          label={scheduleStrings.switchSchedule}
          width="trigger"
          selectionMode="single"
          selectedKeys={[keyOf(current)]}
          disabledKeys={disabled}
          onAction={(key) => {
            const id = String(key);
            if (id === CREATE) onCreate();
            else if (id === `${ACT}rename`) onRename();
            else if (id === `${ACT}default`) onSetDefault();
            else if (id === `${ACT}duplicate`) onDuplicate();
            else if (id === `${ACT}delete`) onDelete();
            else {
              const chosen = schedules.find((each) => keyOf(each) === id);
              if (chosen !== undefined && keyOf(chosen) !== keyOf(current)) onOpen(chosen);
            }
          }}
        >
          <MenuSection label={scheduleStrings.schedules} isLabelHidden={!hasHeadings}>
            {schedules.map((schedule) => (
              <MenuItem
                key={keyOf(schedule)}
                id={keyOf(schedule)}
                {...(schedule.isDefault ? { meta: scheduleStrings.defaultBadge } : {})}
              >
                {schedule.name}
              </MenuItem>
            ))}
          </MenuSection>
          {isFull ? null : <MenuSeparator />}
          {isFull ? null : (
            <MenuSection label={scheduleStrings.newSchedule} isLabelHidden selectionMode="none">
              <MenuItem id={CREATE} icon="plus">
                {scheduleStrings.newSchedule}
              </MenuItem>
            </MenuSection>
          )}
          {actions.length === 0 ? null : <MenuSeparator />}
          {actions.length === 0 ? null : (
            <MenuSection label={scheduleStrings.thisSchedule} isLabelHidden={!hasHeadings} selectionMode="none">
              {actions.map((action) => (
                <MenuItem key={action.id} id={`${ACT}${action.id}`} icon={action.icon} isDanger={action.isDanger}>
                  {action.label}
                </MenuItem>
              ))}
            </MenuSection>
          )}
        </Menu>
      </MenuTrigger>
      {current.isDefault && <Badge text={scheduleStrings.defaultBadge} />}
    </>
  );
}
