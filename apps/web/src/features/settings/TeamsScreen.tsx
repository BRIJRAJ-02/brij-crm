// Brief
// Purpose: Settings › Workspace › Teams (spec 0031, slice 8, AC-824, AC-827): the groups of people that access rules
// name, each with who is in it.
// Main task: owners and admins make a team, change its name and people, or delete it (Undo brings it back); everyone
// reads who is in which team.
// Leaves out: what a team may see (an object's Access tab), team pages and team calendars, and guests.
import { isDataError, type DataLayer, type MemberView, type TeamView } from '@crm/data';
import { AvatarStack, Button, Callout, EmptyState, sharedStrings, Table, type TableColumn, type Toasts } from '@crm/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { focusTitle } from '../navigation/focus-title.ts';
import { objectSettingsHref } from './nav.ts';
import { SettingsPage } from './SettingsPage.tsx';
import { TeamDialog } from './TeamDialog.tsx';
import {
  delegationsOverTeam,
  forgetTeamDelegations,
  TeamDeleteDialog,
  type TeamDeleteQuestion,
} from './TeamDeleteDialog.tsx';
import { strings } from './teams-strings.ts';

/** Props for the Teams page: what its route loaded through the data layer. */
export interface TeamsScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly teams: readonly TeamView[];
  /** Everyone who can be in a team. */
  readonly members: readonly MemberView[];
  /** Holders of `teams.manage` change teams; everyone else reads them. */
  readonly canManage: boolean;
}

const READ_COLUMNS: readonly TableColumn[] = [
  { id: 'team', label: strings.columns.team, isRowHeader: true },
  { id: 'people', label: strings.columns.people, isInline: true },
];

const MANAGE_COLUMNS: readonly TableColumn[] = [
  ...READ_COLUMNS,
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

/** The message a refusal shows, in the server's words when it gave any. */
const messageOf = (error: unknown) => (isDataError(error) ? error.message : strings.somethingWrong);

/** The Teams page: one list with each team's people as a row of faces, and the dialog that changes a team. */
export function TeamsScreen({ data, toasts, slug, teams, members, canManage }: TeamsScreenProps) {
  const router = useRouter();
  const navigate = useNavigate();
  // The dialog: whether it is open, and the team it opened on (none for a new one). The team stays while it closes.
  const [isOpen, setOpen] = useState(false);
  const [editing, setEditing] = useState<TeamView | undefined>(undefined);
  const openOn = (team: TeamView | undefined) => {
    setEditing(team);
    setOpen(true);
  };
  // The team whose delete is on its way: its button spins until the answer.
  const [deleting, setDeleting] = useState<string | undefined>(undefined);
  // Another admin's change reads the list again and the route reloads (the live `members` event).
  useEffect(() => data.teams.watch(slug), [data, slug]);
  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const reload = () => router.invalidate();

  const peopleOf = (team: TeamView): readonly MemberView[] =>
    team.memberIds.flatMap((id) => {
      const person = byId.get(id);
      return person === undefined ? [] : [person];
    });

  // A team's change: its name when it changed, then its people (added and taken out together).
  const save = async (
    team: TeamView | undefined,
    change: { readonly name: string; readonly memberIds: readonly string[] },
  ) => {
    // Whatever landed shows, even when a later call was refused.
    try {
      if (team === undefined) {
        await data.teams.create(slug, { name: change.name, memberIds: change.memberIds });
        toasts.toast({ tone: 'success', message: strings.created(change.name) });
        return;
      }
      const add = change.memberIds.filter((id) => !team.memberIds.includes(id));
      const remove = team.memberIds.filter((id) => !change.memberIds.includes(id));
      const renamed = change.name !== team.name;
      if (renamed) await data.teams.rename(slug, team.id, change.name);
      if (add.length > 0 || remove.length > 0) await data.teams.changeMembers(slug, team.id, { add, remove });
      // Nothing changed: it closes without saying it saved.
      if (renamed || add.length > 0 || remove.length > 0) {
        toasts.toast({ tone: 'success', message: strings.saved(change.name) });
      }
    } finally {
      await reload();
    }
  };

  // A team that scheduling access names asks first (spec 0037, AC-1269): its delegations go with it, and Undo
  // can't bring them back.
  const [question, setQuestion] = useState<TeamDeleteQuestion | undefined>(undefined);
  const ask = (team: TeamView) => {
    if (deleting !== undefined) return;
    setDeleting(team.id);
    void delegationsOverTeam(data, slug, team.id).then((over) => {
      if (over !== undefined && over.length === 0) {
        remove(team, true);
        return;
      }
      setDeleting(undefined);
      setQuestion({ team, over });
    });
  };

  // A delete is one click with Undo: a team no rule names holds no access, so nothing is lost. The Undo makes the
  // same team again, with the same id and people. One that took scheduling access with it was confirmed: no Undo.
  const remove = (team: TeamView, isUndoable: boolean) => {
    setDeleting(team.id);
    data.teams.delete(slug, team.id).then(
      async () => {
        if (!isUndoable) forgetTeamDelegations(data, slug);
        await reload();
        setDeleting(undefined);
        // The button that asked went away with the row.
        focusTitle();
        if (!isUndoable) {
          toasts.toast({ tone: 'success', message: strings.deleted(team.name) });
          return;
        }
        toasts.toast({
          tone: 'success',
          message: strings.deleted(team.name),
          action: {
            label: strings.undo,
            onAction: () => {
              data.teams.create(slug, { id: team.id, name: team.name, memberIds: team.memberIds }).then(
                async () => {
                  await reload();
                  toasts.toast({ tone: 'success', message: strings.restored(team.name) });
                },
                (error: unknown) => {
                  toasts.toast({ tone: 'danger', message: messageOf(error) });
                },
              );
            },
          },
        });
      },
      (error: unknown) => {
        setDeleting(undefined);
        // A team an access rule names stays, and the toast opens the rule that holds it (the first object's Access).
        if (isDataError(error) && error.code === 'IN_USE') {
          // The toast waits a moment for the link at most: the refusal itself is never held up by the search.
          const quickly = new Promise<undefined>((resolve) => {
            setTimeout(() => {
              resolve(undefined);
            }, 1500);
          });
          void Promise.race([blocker(team), quickly]).then((href) => {
            toasts.toast({
              tone: 'danger',
              message: error.message,
              ...(href === undefined
                ? {}
                : {
                    action: {
                      label: strings.openAccess,
                      onAction: () => {
                        void navigate({ to: href });
                      },
                    },
                  }),
            });
          });
          return;
        }
        toasts.toast({ tone: 'danger', message: messageOf(error) });
      },
    );
  };

  /** The Access tab of the first object whose rules name the team, or none when they can't be read (the toast then stands alone). */
  const blocker = async (team: TeamView): Promise<string | undefined> => {
    const objects = await data.objects.all(slug).catch(() => []);
    const reads = await Promise.all(
      objects.map((object) =>
        data.accessRules.get(slug, object.id).then(
          (access) =>
            access.subjects.some((each) => each.subject.type === 'team' && each.subject.teamId === team.id)
              ? object
              : undefined,
          () => undefined,
        ),
      ),
    );
    const found = reads.find((object) => object !== undefined);
    return found === undefined ? undefined : objectSettingsHref(slug, found, 'access');
  };

  const cell = (team: TeamView, column: string) => {
    switch (column) {
      case 'team':
        return canManage ? (
          <Button
            variant="link"
            onPress={() => {
              openOn(team);
            }}
          >
            {team.name}
          </Button>
        ) : (
          team.name
        );
      case 'people': {
        const people = peopleOf(team);
        if (people.length === 0) return strings.noOne;
        // Someone who can't change the team reads who is in it; faces alone are initials. Others get faces, and the
        // dialog names them.
        if (!canManage) return people.map((person) => person.name).join(', ');
        return (
          <AvatarStack
            people={people.slice(0, 6).map((person) => ({
              id: person.id,
              name: person.name,
              ...(person.avatarUrl === undefined ? {} : { src: person.avatarUrl }),
            }))}
            total={people.length}
            label={strings.peopleIn(team.name, people.length)}
            max={6}
          />
        );
      }
      default:
        return (
          <Button
            variant="ghost-danger"
            icon="trash"
            label={strings.removeTeam(team.name)}
            isPending={deleting === team.id}
            onPress={() => {
              ask(team);
            }}
          />
        );
    }
  };

  const newTeam = (
    <Button
      variant="primary"
      icon="plus"
      onPress={() => {
        openOn(undefined);
      }}
    >
      {strings.newTeam}
    </Button>
  );

  return (
    <SettingsPage title={strings.title} {...(canManage ? { actions: newTeam } : {})}>
      {teams.length === 0 ? (
        <EmptyState icon="users-round" title={strings.emptyTitle}>
          {/* New team sits in the page head; a reader hears who makes them. */}
          {canManage ? undefined : strings.readerEmptyText}
        </EmptyState>
      ) : (
        <>
          <Table
            label={strings.title}
            columns={canManage ? MANAGE_COLUMNS : READ_COLUMNS}
            rows={teams}
            getRowId={(team) => team.id}
            renderCell={cell}
            isScrollable
          />
          {!canManage && <Callout>{sharedStrings.ownersAndAdminsOnly}</Callout>}
        </>
      )}
      {canManage && (
        <TeamDialog
          // Another team starts from its own people, not the last one's edits.
          key={editing?.id ?? 'new'}
          isOpen={isOpen}
          onOpenChange={setOpen}
          team={editing}
          members={members}
          onSave={(change) => save(editing, change)}
        />
      )}
      <TeamDeleteDialog
        question={question}
        onConfirm={(team) => {
          remove(team, false);
        }}
        onClose={() => {
          setQuestion(undefined);
        }}
      />
    </SettingsPage>
  );
}

/** The Teams page while it loads: the bar's place and rows where the list will be. */
export function TeamsPending() {
  // The actions column's place only for those who get it, so nothing moves when the page arrives.
  const canManage = useCan('teams.manage');
  return (
    <SettingsPage title={strings.loading} isLoading>
      <Table
        label={strings.loading}
        columns={canManage ? MANAGE_COLUMNS : READ_COLUMNS}
        rows={[]}
        getRowId={() => ''}
        renderCell={() => null}
        isLoading
      />
    </SettingsPage>
  );
}
