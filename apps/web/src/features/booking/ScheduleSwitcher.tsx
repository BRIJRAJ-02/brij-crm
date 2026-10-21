// Brief
// Purpose: the Availability tab's schedule switcher (spec 0035, AC-962, AC-964, AC-967, AC-969): the open schedule's name with its Default badge, and one menu to switch, make, rename, set as default, duplicate or delete.
// Main task: open another schedule, or act on the open one; Delete asks first, in the screen's confirm.
// Leaves out: the hours (the tab's editor), and acting on the virtual default before its first save.
import type { ScheduleView } from '@crm/data';
import type { Ref } from 'react';
import { Badge, Button, Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger } from '@crm/ui';
import { scheduleStrings } from './schedule-strings.ts';

/** Props for ScheduleSwitcher. */
export interface ScheduleSwitcherProps {
  /** The member's schedules, the default first. */
  readonly schedules: readonly ScheduleView[];
  /** The one open in the tab. */
  readonly current: ScheduleView;
  /** The member holds as many schedules as they may: New schedule and Duplicate wait, and say why. */
  readonly isFull: boolean;
  /** Nothing is ready to act on yet (the switcher while the tab loads). */
  readonly isDisabled?: boolean;
  /** Whether the schedules are the reader's own, for the words ("your default", "their default"). */
  readonly isOwn?: boolean;
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
 * The open schedule's name as a menu button, with Default beside it. The menu lists the schedules to switch to
 * (the open one checked), New schedule, then this schedule's own actions. An action the schedule can't take stays,
 * disabled, with its reason as its second line: the default is already the default and can't be deleted; a full
 * list can't take another; the virtual default has nothing to act on until its hours are saved.
 */
export function ScheduleSwitcher({
  schedules,
  current,
  isFull,
  isDisabled = false,
  isOwn = true,
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
  const unsaved = isVirtual || isPending;
  const reason = (id: string): string | undefined => {
    if (unsaved && id !== 'default') return isVirtual ? scheduleStrings.saveDefaultFirst : scheduleStrings.copying;
    if (id === 'default' && current.isDefault)
      return isOwn ? scheduleStrings.alreadyDefault : scheduleStrings.alreadyTheirDefault;
    if (id === 'delete' && current.isDefault) return scheduleStrings.cantDeleteDefault;
    if (id === 'duplicate' && isFull) return scheduleStrings.limitReached;
    return undefined;
  };
  const actions = [
    { id: 'rename', icon: 'pencil', label: scheduleStrings.rename },
    { id: 'default', icon: 'star', label: scheduleStrings.setDefault },
    { id: 'duplicate', icon: 'copy', label: scheduleStrings.duplicate },
  ] as const;
  const deleteReason = reason('delete');
  const disabled = [
    ...(isFull ? [CREATE] : []),
    ...[...actions.map((each) => each.id), 'delete']
      .filter((id) => reason(id) !== undefined)
      .map((id) => `${ACT}${id}`),
    // A copy on its way can't be opened until the server made it.
    ...schedules.filter((each) => each.id !== null && each.updatedAt === null).map(keyOf),
  ];
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
          <MenuSection label={scheduleStrings.schedules}>
            {schedules.map((schedule) => (
              <MenuItem
                key={keyOf(schedule)}
                id={keyOf(schedule)}
                icon="clock"
                {...(schedule.isDefault ? { meta: scheduleStrings.defaultBadge } : {})}
              >
                {schedule.name}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSeparator />
          <MenuItem id={CREATE} icon="plus" {...(isFull ? { description: scheduleStrings.limitReached } : {})}>
            {scheduleStrings.newSchedule}
          </MenuItem>
          <MenuSeparator />
          <MenuSection label={scheduleStrings.thisSchedule} selectionMode="none">
            {[
              ...actions.map((action) => {
                const why = reason(action.id);
                return (
                  <MenuItem
                    key={action.id}
                    id={`${ACT}${action.id}`}
                    icon={action.icon}
                    {...(why === undefined ? {} : { description: why })}
                  >
                    {action.label}
                  </MenuItem>
                );
              }),
              <MenuSeparator key="separator" />,
              <MenuItem
                key="delete"
                id={`${ACT}delete`}
                icon="trash"
                isDanger
                {...(deleteReason === undefined ? {} : { description: deleteReason })}
              >
                {scheduleStrings.delete}
              </MenuItem>,
            ]}
          </MenuSection>
        </Menu>
      </MenuTrigger>
      {current.isDefault && <Badge text={scheduleStrings.defaultBadge} />}
    </>
  );
}
