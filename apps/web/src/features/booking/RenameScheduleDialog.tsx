// Brief
// Purpose: Rename a schedule (spec 0035, AC-970), from the Availability tab's schedule menu.
// Main task: type the new name and Rename; a name another schedule has is said on the field.
// Leaves out: the hours (they save as they change in the tab) and the virtual default, which is named once it's saved.
import { isDataError, type DataLayer, type ScheduleView } from '@crm/data';
import { Button, Callout, Field, Modal } from '@crm/ui';
import { useState } from 'react';
import { SCHEDULE_NAME_MAX } from './scheduleDraft.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** Props for the dialog. */
export interface RenameScheduleDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The schedule to rename; undefined keeps the dialog closed. */
  readonly schedule: ScheduleView | undefined;
  readonly onClose: () => void;
  readonly onRenamed: (schedule: ScheduleView) => void;
}

/** The dialog: Name, then Cancel or Rename. A text field saves with its own button, never as it is typed. */
export function RenameScheduleDialog({ data, slug, schedule, onClose, onRenamed }: RenameScheduleDialogProps) {
  return schedule === undefined ? null : (
    <Opened
      key={schedule.id ?? 'virtual'}
      data={data}
      slug={slug}
      schedule={schedule}
      onClose={onClose}
      onRenamed={onRenamed}
    />
  );
}

function Opened({
  data,
  slug,
  schedule,
  onClose,
  onRenamed,
}: RenameScheduleDialogProps & { readonly schedule: ScheduleView }) {
  const [name, setName] = useState(schedule.name);
  const [isBusy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const rename = () => {
    if (isBusy) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError(scheduleStrings.nameRequired);
      return;
    }
    if (trimmed === schedule.name) {
      onClose();
      return;
    }
    setBusy(true);
    setNameError(undefined);
    setFailure(undefined);
    data.schedules.update(slug, schedule, { name: trimmed }).then(
      (stored) => {
        setBusy(false);
        onRenamed(stored);
      },
      (error: unknown) => {
        setBusy(false);
        const message = isDataError(error) ? error.message : strings.somethingWrong;
        if (isDataError(error) && error.code === 'NAME_TAKEN') setNameError(message);
        else setFailure(`${scheduleStrings.renameFailed} ${message}`);
      },
    );
  };
  return (
    <Modal
      title={scheduleStrings.renameTitle(schedule.name)}
      isOpen
      isBusy={isBusy}
      // While the server answers, the dialog stays: a refusal has to land on its field.
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={rename}>
            {isBusy ? scheduleStrings.renaming : scheduleStrings.renameCommit}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Field
        label={scheduleStrings.name}
        hint={scheduleStrings.nameHint}
        value={name}
        maxLength={SCHEDULE_NAME_MAX}
        isRequired
        // The dialog opens to rename it: its one field is what the press asked for.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        onChange={(value) => {
          setName(value);
          setNameError(undefined);
        }}
        onSubmit={rename}
        {...(nameError === undefined ? {} : { error: nameError })}
      />
    </Modal>
  );
}
