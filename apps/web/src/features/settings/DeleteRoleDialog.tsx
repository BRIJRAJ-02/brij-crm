// Brief
// Purpose: ask before a custom role goes (spec 0037, AC-1238, AC-1445): where its people move.
// Main task: pick Member or another custom role for its people, then Delete role; it closes once the server agrees.
// Leaves out: the role's own page, and the people one by one (Members).
import { isDataError, type RoleDefinition } from '@crm/data';
import { Button, Callout, Modal, Select, sharedStrings } from '@crm/ui';
import { useState } from 'react';
import { strings } from './roles-strings.ts';

/** Props for the delete confirm. */
export interface DeleteRoleDialogProps {
  /** The role asked about; undefined while closed. */
  readonly role: RoleDefinition | undefined;
  readonly roles: readonly RoleDefinition[];
  readonly onClose: () => void;
  /** Deletes it, moving its people to `moveTo` (`member` or a custom role's id); rejects with the refusal. */
  readonly onDelete: (role: RoleDefinition, moveTo: string) => Promise<void>;
}

/** A danger Modal: what the role holds now, where its people go, Cancel and Delete role. */
export function DeleteRoleDialog({ role, roles, onClose, onDelete }: DeleteRoleDialogProps) {
  // The last role stays while the Modal plays its exit.
  const [last, setLast] = useState(role);
  if (role !== undefined && role !== last) setLast(role);
  const shown = role ?? last;
  return shown === undefined ? null : (
    <Asked
      key={shown.id}
      role={shown}
      roles={roles}
      isOpen={role !== undefined}
      onClose={onClose}
      onDelete={onDelete}
    />
  );
}

function Asked({
  role,
  roles,
  isOpen,
  onClose,
  onDelete,
}: Omit<DeleteRoleDialogProps, 'role'> & { readonly role: RoleDefinition; readonly isOpen: boolean }) {
  const [moveTo, setMoveTo] = useState('member');
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const holders = role.holders ?? 0;
  const targets = [
    { id: 'member', label: strings.member },
    ...roles
      .filter((each) => each.builtIn === undefined && each.id !== role.id)
      .map((each) => ({ id: each.id, label: each.label, group: strings.custom })),
  ];
  const commit = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    onDelete(role, moveTo).then(
      () => {
        setBusy(false);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : sharedStrings.couldntDoThat);
      },
    );
  };
  return (
    <Modal
      title={strings.deleteTitle(role.label)}
      variant="confirm"
      tone="danger"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" isPending={isBusy} onPress={commit}>
            {isBusy ? strings.deleting : strings.deleteAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {strings.deleteText(role.label, holders)}
      {holders > 0 && (
        <Select
          label={strings.moveTo(holders)}
          items={targets}
          value={moveTo}
          isDisabled={isBusy}
          onChange={(chosen) => {
            if (chosen !== null) setMoveTo(chosen);
          }}
        />
      )}
    </Modal>
  );
}
