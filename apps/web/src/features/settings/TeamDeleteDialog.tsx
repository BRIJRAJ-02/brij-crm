// Brief
// Purpose: the confirm before deleting a team that scheduling access names (spec 0037, AC-1269): its delegations go
// with it, which Undo can't bring back, so the delete asks first and says who loses what.
// Main task: read the consequence in one line, then delete or keep the team.
// Leaves out: access rules (they refuse the delete, AC-826), the delegations' details (the Members page's column).
import type { DataLayer, DelegationView, TeamView } from '@crm/data';
import { Button, Modal } from '@crm/ui';
import { useState } from 'react';
import { strings } from './teams-strings.ts';

/** A delete waiting on its confirm: the team and the delegations over it (undefined: they couldn't be read). */
export interface TeamDeleteQuestion {
  readonly team: TeamView;
  readonly over: readonly DelegationView[] | undefined;
}

/**
 * The workspace's delegations over `teamId`, from the scheduling access store's one held list (the Members page's
 * too). Undefined when it can't be read, so the delete asks rather than offering an Undo that couldn't bring
 * scheduling access back (the server deletes it either way).
 */
export async function delegationsOverTeam(
  data: DataLayer,
  slug: string,
  teamId: string,
): Promise<readonly DelegationView[] | undefined> {
  try {
    const store = await data.scheduling.open();
    const held = store.delegations(slug, 'everyone');
    await held.ready();
    const state = held.getSnapshot();
    if (state.status !== 'ready') return undefined;
    return state.delegations.filter((each) => each.target.type === 'team' && each.target.teamId === teamId);
  } catch {
    return undefined;
  }
}

/** After a delete: the held delegations read again, so the Members page drops the team's rows. */
export function forgetTeamDelegations(data: DataLayer, slug: string): void {
  data.scheduling.loaded()?.delegations(slug, 'everyone').reload();
}

/** The danger confirm: "2 people lose access to manage Sales’ scheduling." */
export function TeamDeleteDialog({
  question,
  onConfirm,
  onClose,
}: {
  readonly question: TeamDeleteQuestion | undefined;
  readonly onConfirm: (team: TeamView) => void;
  readonly onClose: () => void;
}) {
  // The last question stays while the Modal plays its exit.
  const [last, setLast] = useState(question);
  if (question !== undefined && question !== last) setLast(question);
  const shown = question ?? last;
  if (shown === undefined) return null;
  const over = shown.over;
  const people = new Set(over?.map((each) => each.delegateMemberId)).size;
  const levels = new Set(over?.map((each) => each.level));
  const level = levels.size > 1 ? 'both' : levels.has('manage') ? 'manage' : 'view';
  return (
    <Modal
      title={strings.deleteTitle(shown.team.name)}
      variant="confirm"
      tone="danger"
      isOpen={question !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.keepTeam}</Button>
          <Button
            variant="danger-solid"
            onPress={() => {
              onConfirm(shown.team);
              onClose();
            }}
          >
            {strings.deleteTeam}
          </Button>
        </>
      }
    >
      <p>
        {over === undefined
          ? strings.loseSchedulingUnknown(shown.team.name)
          : strings.loseScheduling(people, level, shown.team.name)}
      </p>
    </Modal>
  );
}
