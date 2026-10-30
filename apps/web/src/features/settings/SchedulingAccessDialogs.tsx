// Brief
// Purpose: the two dialogs of scheduling access (spec 0037, AC-1266, AC-1267, AC-1445): give a teammate See or Manage
// over someone's scheduling, and ask before taking access back.
// Main task: pick a person (or everyone) and a level, then Add; or read what ends and Remove access.
// Leaves out: who may grant what (the server's; a refusal comes back as a toast and the row is put back) and teams.
import type { MemberView, SchedulingLevel } from '@crm/data';
import { Avatar, Button, Callout, Modal, SegmentedControl, Select } from '@crm/ui';
import { useState } from 'react';
import { strings } from './scheduling-access-strings.ts';

/** A member as the person pickers list them: their picture (or initials) and their email under the name. */
export function personItem(member: Pick<MemberView, 'id' | 'name' | 'email' | 'avatarUrl'>) {
  return {
    id: member.id,
    label: member.name,
    description: member.email,
    leading: (
      <Avatar
        name={member.name}
        id={member.id}
        size="xs"
        {...(member.avatarUrl === undefined ? {} : { src: member.avatarUrl })}
        isDecorative
      />
    ),
  };
}

/** See or Manage, as one control: the level's own sentence under it says what it lets them do. */
export function LevelControl({
  value,
  onChange,
  label = strings.level,
  isLabelVisible = true,
}: {
  readonly value: SchedulingLevel;
  readonly onChange: (level: SchedulingLevel) => void;
  readonly label?: string;
  readonly isLabelVisible?: boolean;
}) {
  return (
    <SegmentedControl
      label={label}
      {...(isLabelVisible ? { isLabelVisible: true } : {})}
      size="compact"
      segments={[
        { value: 'view', label: strings.see, icon: 'eye' },
        { value: 'manage', label: strings.manage, icon: 'pencil' },
      ]}
      value={value}
      onChange={(next) => onChange(next === 'manage' ? 'manage' : 'view')}
    />
  );
}

/** See or Manage as one quiet inline Select in a row, each with what it allows (the page's rows, the popover's). */
export function LevelSelect({
  name,
  value,
  onChange,
}: {
  readonly name: string;
  readonly value: SchedulingLevel;
  readonly onChange: (level: SchedulingLevel) => void;
}) {
  return (
    <Select
      savesOnPick
      label={strings.levelFor(name)}
      isLabelHidden
      variant="inline"
      items={[
        { id: 'view', label: strings.see, description: strings.seeDescription },
        { id: 'manage', label: strings.manage, description: strings.manageDescription },
      ]}
      value={value}
      onChange={(next) => {
        if (next === 'view' || next === 'manage') {
          if (next !== value) onChange(next);
        }
      }}
    />
  );
}

/** Props for the Add someone dialog. */
export interface AddDelegateDialogProps {
  readonly isOpen: boolean;
  /** The teammates who may be added: active, not the member themself, not already holding access. */
  readonly people: readonly Pick<MemberView, 'id' | 'name' | 'email' | 'avatarUrl'>[];
  /** The member's hours are set by others (no `availability.own`): Manage can't change them (decision 9). */
  readonly hoursSetByOthers: boolean;
  readonly onClose: () => void;
  /** Gives the access: the screen shows it at once, and the data layer puts it back with a toast if refused. */
  readonly onAdd: (memberId: string, level: SchedulingLevel) => void;
}

/**
 * Settings › Account › Scheduling access's Add someone (AC-1266): a person picker (searchable, with pictures) and
 * See or Manage. Add closes at once: the row is already there, and comes back out with the reason if refused.
 */
export function AddDelegateDialog({ isOpen, people, hoursSetByOthers, onClose, onAdd }: AddDelegateDialogProps) {
  const [person, setPerson] = useState<string | null>(null);
  const [level, setLevel] = useState<SchedulingLevel>('view');
  const close = () => {
    setPerson(null);
    setLevel('view');
    onClose();
  };
  const add = () => {
    if (person === null) return;
    onAdd(person, level);
    close();
  };
  return (
    <Modal
      title={strings.addTitle}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" isDisabled={person === null} onPress={add}>
            {strings.add}
          </Button>
        </>
      }
    >
      {people.length === 0 ? (
        <Callout tone="info">{strings.nobodyToAdd}</Callout>
      ) : (
        <>
          <Select
            label={strings.person}
            placeholder={strings.personPlaceholder}
            items={people.map(personItem)}
            value={person}
            onChange={setPerson}
            isSearchable
          />
          <LevelControl value={level} onChange={setLevel} />
          <p>{level === 'manage' ? strings.manageDescription : strings.seeDescription}</p>
          {level === 'manage' && hoursSetByOthers && <Callout tone="info">{strings.hoursStaySet}</Callout>}
        </>
      )}
    </Modal>
  );
}

/** One question before access ends (AC-1445): its title names whose access, its sentence says what is lost. */
export interface RemoveAccessQuestion {
  readonly title: string;
  readonly text: string;
  readonly run: () => void;
}

/**
 * The danger confirm before taking access back. Remove access closes it at once (the row goes, and comes back with
 * a toast if the server refuses), so it never waits on the network.
 */
export function RemoveAccessDialog({
  question,
  onClose,
}: {
  readonly question: RemoveAccessQuestion | undefined;
  readonly onClose: () => void;
}) {
  // The last question stays while the Modal plays its exit.
  const [last, setLast] = useState(question);
  if (question !== undefined && question !== last) setLast(question);
  const shown = question ?? last;
  if (shown === undefined) return null;
  return (
    <Modal
      title={shown.title}
      variant="confirm"
      tone="danger"
      isOpen={question !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.keep}</Button>
          <Button
            variant="danger-solid"
            onPress={() => {
              shown.run();
              onClose();
            }}
          >
            {strings.removeAction}
          </Button>
        </>
      }
    >
      <p>{shown.text}</p>
    </Modal>
  );
}
