// Brief
// Purpose: make a team, or change one's name and people, from Settings › Teams.
// Main task: type a name, pick the people, Save; it closes once the server agrees.
// Leaves out: deleting (the row's button, with Undo), and what the team may see (an object's Access tab).
import type { MemberView, TeamView } from '@crm/data';
import { Avatar, Button, Field, Form, Modal, Select, type FormRefusal } from '@crm/ui';
import { useId, useState } from 'react';
import { formRefusals } from './refusals.ts';
import { strings } from './teams-strings.ts';

/** Props for the team dialog. */
export interface TeamDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The team being changed; undefined makes a new one. */
  readonly team: TeamView | undefined;
  /** Everyone who can be in a team. */
  readonly members: readonly MemberView[];
  /** Saves and waits for the server; rejects with its refusals, which land on the name or above the fields. */
  readonly onSave: (change: { readonly name: string; readonly memberIds: readonly string[] }) => Promise<void>;
}

/** The form's fields, as the server names them on its refusals. */
const FIELDS = ['name'] as const;

/** "New team" or "Edit <team>": a Modal with a name and the people, Save waiting for the server. */
export function TeamDialog({ isOpen, onOpenChange, team, members, onSave }: TeamDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  return (
    <Modal
      title={team === undefined ? strings.createTitle : strings.editTitle(team.name)}
      variant="window"
      isOpen={isOpen}
      // While the server answers, the dialog stays: a refusal has to land on its field.
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {team === undefined ? (isBusy ? strings.creating : strings.create) : isBusy ? strings.saving : strings.save}
          </Button>
        </>
      }
    >
      <TeamForm
        formId={formId}
        team={team}
        members={members}
        isBusy={isBusy}
        onBusyChange={setBusy}
        onSave={onSave}
        onSaved={() => {
          onOpenChange(false);
        }}
      />
    </Modal>
  );
}

/** The form, mounted afresh with each opening so it starts from the team as it stands. */
function TeamForm({
  formId,
  team,
  members,
  isBusy,
  onBusyChange,
  onSave,
  onSaved,
}: Pick<TeamDialogProps, 'team' | 'members' | 'onSave'> & {
  readonly formId: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
  readonly onSaved: () => void;
}) {
  const [name, setName] = useState(team?.name ?? '');
  const [memberIds, setMemberIds] = useState<readonly string[]>(team?.memberIds ?? []);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const items = members.map((member) => ({
    id: member.id,
    label: member.name,
    leading: <Avatar id={member.id} name={member.name} size="xs" isDecorative {...avatarOf(member)} />,
  }));
  const save = () => {
    if (isBusy) return;
    if (name.trim() === '') {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'name' }]);
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    onSave({ name: name.trim(), memberIds }).then(
      () => {
        onBusyChange(false);
        onSaved();
      },
      (error: unknown) => {
        onBusyChange(false);
        setRefusals(formRefusals(error, FIELDS));
      },
    );
  };
  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={refusals}
      fieldFor={(refusal) => refusal.attributeId}
      onSubmit={save}
      label={team === undefined ? strings.createTitle : strings.editTitle(team.name)}
      focusesFirstField
    >
      <Field
        label={strings.name}
        placeholder={strings.namePlaceholder}
        name="name"
        autoComplete="off"
        isRequired
        maxLength={64}
        value={name}
        onChange={setName}
      />
      <Select
        label={strings.members}
        placeholder={strings.membersPlaceholder}
        selectionMode="multiple"
        isSearchable
        searchLabel={strings.members}
        maxVisible={3}
        items={items}
        values={[...memberIds]}
        onValuesChange={(next) => {
          setMemberIds(next);
        }}
      />
    </Form>
  );
}

/** A member's picture, when they have one. */
function avatarOf(member: MemberView): { readonly src?: string } {
  return member.avatarUrl === undefined ? {} : { src: member.avatarUrl };
}
