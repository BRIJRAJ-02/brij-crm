// Whose scheduling a screen shows (AC-971; spec 0037, AC-1268): the reader's own or a colleague's in their See reach,
// by name, the ones they may only See marked so. Availability's schedules and Bookings settings' Meeting limits share
// it, so one choice reads the same in both. `members.visible` answers the choices, the reader first.
import type { VisibleMember } from '@crm/data';
import { Select } from '@crm/ui';
import { scheduleStrings } from './schedule-strings.ts';

/** Props for WhoseSelect. */
export interface WhoseSelectProps {
  /** The Select's name ("Viewing", "Whose limits"). */
  readonly label: string;
  readonly members: readonly VisibleMember[];
  readonly me: string;
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** The reader's own option ("My schedules"). */
  readonly mine: string;
  /** A colleague's option ("Priya Nair’s schedules"). */
  readonly theirs: (name: string) => string;
  readonly isDisabled?: boolean;
}

/** The compact, searchable Select of whose to show, a See only colleague marked so before they open them. */
export function WhoseSelect({
  label,
  members,
  me,
  value,
  onChange,
  mine,
  theirs,
  isDisabled = false,
}: WhoseSelectProps) {
  return (
    <Select
      label={label}
      isLabelHidden
      size="sm"
      isSearchable
      isDisabled={isDisabled}
      showsDescription
      items={members.map((each) => ({
        id: each.id,
        label: each.id === me ? mine : theirs(each.name),
        ...(each.id === me || each.canManage ? {} : { description: scheduleStrings.seeOnlyShort }),
      }))}
      value={value}
      onChange={(id) => {
        if (id !== null && id !== value) onChange(id);
      }}
    />
  );
}
