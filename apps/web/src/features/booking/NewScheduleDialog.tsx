// Brief
// Purpose: New schedule (spec 0035, AC-964): a name, then a schedule with the default's weekly hours and time zone, opened in its editor.
// Main task: type a name and Create schedule; a name another schedule has is said on the field.
// Leaves out: the hours (the new schedule's editor), and copying a schedule other than the default (Duplicate does that).
import { isDataError, type DataLayer, type ScheduleView } from '@crm/data';
import { Button, Callout, Field, Modal } from '@crm/ui';
import { useState } from 'react';
import { browserZone } from './zone.ts';
import { SCHEDULE_NAME_MAX } from './scheduleDraft.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** Props for the dialog. */
export interface NewScheduleDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Whose schedules it joins. */
  readonly memberId: string;
  /** A colleague's (an admin's view, AC-971): the API names the member then. */
  readonly forMember: boolean;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Made: the screen opens it. */
  readonly onCreated: (schedule: ScheduleView) => void;
}

/** The dialog: Name, then Cancel or Create schedule. The id is minted once per opening, so a retry makes one. */
export function NewScheduleDialog({
  data,
  slug,
  memberId,
  forMember,
  isOpen,
  onClose,
  onCreated,
}: NewScheduleDialogProps) {
  const [name, setName] = useState('');
  const [id, setId] = useState(() => data.schedules.newId());
  const [isBusy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const reset = () => {
    setName('');
    setNameError(undefined);
    setFailure(undefined);
    setId(data.schedules.newId());
  };
  const create = () => {
    if (isBusy) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError(scheduleStrings.nameRequired);
      return;
    }
    setBusy(true);
    setNameError(undefined);
    setFailure(undefined);
    data.schedules.create(slug, memberId, { id, name: trimmed, timeZone: browserZone(), forMember }).then(
      (schedule) => {
        setBusy(false);
        reset();
        onCreated(schedule);
      },
      (error: unknown) => {
        setBusy(false);
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        const message = isDataError(error) ? error.message : strings.somethingWrong;
        if (field === 'name') setNameError(message);
        else setFailure(message);
      },
    );
  };
  return (
    <Modal
      title={scheduleStrings.newSchedule}
      isOpen={isOpen}
      isBusy={isBusy}
      // While the server answers, the dialog stays: a refusal has to land on its field.
      onOpenChange={(open) => {
        if (open || isBusy) return;
        // Closed is cancelled: it opens empty next time.
        reset();
        onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={create}>
            {isBusy ? scheduleStrings.creatingSchedule : scheduleStrings.createSchedule}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Field
        label={scheduleStrings.name}
        placeholder={scheduleStrings.namePlaceholder}
        hint={scheduleStrings.nameHint}
        value={name}
        maxLength={SCHEDULE_NAME_MAX}
        isRequired
        // The dialog opens to name it: its one field is what the press asked for.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        onChange={(value) => {
          setName(value);
          setNameError(undefined);
        }}
        onSubmit={create}
        {...(nameError === undefined ? {} : { error: nameError })}
      />
    </Modal>
  );
}
