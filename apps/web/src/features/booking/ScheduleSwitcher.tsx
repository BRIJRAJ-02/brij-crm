// Brief
// Purpose: the Availability tab's schedule switcher (spec 0035, AC-962, AC-964, AC-967, AC-969): one plain Select of the member's schedules, each with its quiet facts ("Default · 4 pages"), and a ⋯ menu to rename, duplicate, set as default or delete the open one.
// Main task: open another schedule, or act on the open one; Delete asks first, in the screen's confirm.
// Leaves out: the hours (the tab's editor), New schedule (the TopBar's primary), and acting on the virtual default before its first save.
import type { ScheduleView } from '@crm/data';
import type { Ref } from 'react';
import { Button, Menu, MenuItem, MenuTrigger, Select, type IconName } from '@crm/ui';
import { scheduleStrings } from './schedule-strings.ts';

/** Props for ScheduleSwitcher. */
export interface ScheduleSwitcherProps {
  /** The member's schedules, the default first. */
  readonly schedules: readonly ScheduleView[];
  /** The one open in the tab. */
  readonly current: ScheduleView;
  /** The member holds as many schedules as they may: Duplicate is left out (the TopBar's New says why). */
  readonly isFull: boolean;
  /** Nothing is ready to act on yet (the switcher while the tab loads). */
  readonly isDisabled?: boolean;
  /**
   * The schedules can be read but not changed (spec 0037: a colleague the reader may only See, or one's own hours set
   * by others): the Select only switches between them, and there is no ⋯.
   */
  readonly isReadOnly?: boolean;
  /** The Select's trigger, so the screen can bring focus back to it after a switch remounts the editor. */
  readonly triggerRef?: Ref<HTMLButtonElement>;
  readonly onOpen: (schedule: ScheduleView) => void;
  readonly onRename: () => void;
  readonly onSetDefault: () => void;
  readonly onDuplicate: () => void;
  /** Opens the screen's delete confirm. */
  readonly onDelete: () => void;
}

/** A schedule's key in the Select: its id, or the virtual default's. */
const keyOf = (schedule: ScheduleView) => schedule.id ?? 'default';

/**
 * The open schedule as one Select (critic A15: a menu button with a loose Default badge beside it read as two
 * controls): each schedule an option, the default tagged Default in the list and on the trigger. The open one's own
 * actions sit in the ⋯ after it: Rename, Duplicate, Set as default, Delete. An action that can't apply is left out
 * rather than shown disabled with a reason (the owner, 22 October 2026): no Set as default on the default, no Delete
 * on the default or the only schedule, no Duplicate once the list is full, and no ⋯ while the schedule isn't saved
 * yet.
 */
export function ScheduleSwitcher({
  schedules,
  current,
  isFull,
  isDisabled = false,
  isReadOnly = false,
  triggerRef,
  onOpen,
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
    readonly run: () => void;
  }[] = [
    { id: 'rename', icon: 'pencil', label: scheduleStrings.rename, isDanger: false, applies: isSaved, run: onRename },
    {
      id: 'duplicate',
      icon: 'copy',
      label: scheduleStrings.duplicate,
      isDanger: false,
      applies: isSaved && !isFull,
      run: onDuplicate,
    },
    {
      id: 'default',
      icon: 'star',
      label: scheduleStrings.setDefault,
      isDanger: false,
      applies: isSaved && !current.isDefault,
      run: onSetDefault,
    },
    {
      id: 'delete',
      icon: 'trash',
      label: scheduleStrings.delete,
      isDanger: true,
      applies: isSaved && !current.isDefault && schedules.length > 1,
      run: onDelete,
    },
  ];
  const actions = isReadOnly ? [] : all.filter((action) => action.applies);
  return (
    <>
      <Select
        label={scheduleStrings.switchSchedule}
        isLabelHidden
        size="sm"
        isDisabled={isDisabled}
        {...(triggerRef === undefined ? {} : { triggerRef })}
        items={schedules.map((schedule) => ({
          id: keyOf(schedule),
          label: schedule.name,
          // Quiet facts in the list, not a badge (the simplicity sweep's finding 7): "Default · 4 pages".
          description: scheduleStrings.optionMeta(schedule.isDefault, schedule.pages.length),
          // A copy on its way can't be opened until the server made it.
          ...(schedule.id !== null && schedule.updatedAt === null ? { isDisabled: true } : {}),
        }))}
        value={keyOf(current)}
        onChange={(id) => {
          const chosen = schedules.find((each) => keyOf(each) === id);
          if (chosen !== undefined && keyOf(chosen) !== keyOf(current)) onOpen(chosen);
        }}
      />
      {actions.length > 0 && (
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={scheduleStrings.actionsFor(current.name)} />
          <Menu
            label={scheduleStrings.actionsFor(current.name)}
            onAction={(key) => {
              all.find((action) => action.id === String(key))?.run();
            }}
          >
            {actions.map((action) => (
              <MenuItem key={action.id} id={action.id} icon={action.icon} isDanger={action.isDanger}>
                {action.label}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      )}
    </>
  );
}
