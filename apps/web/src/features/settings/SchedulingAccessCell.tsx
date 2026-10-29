// Brief
// Purpose: the Members page's Scheduling access cell (spec 0037, AC-1267, decision 8): timefix's "Sees all calendars"
// switch widened, for holders of `members.manage`: whose scheduling each person may see or manage beyond their own.
// Main task: read each person's reach in a few words; open it to give them See or Manage over a person or everyone,
// change a level, or take one back (asked first, AC-1445).
// Leaves out: teams (not built), reach from custom roles (not built), "What can Priya do" (the role guide's).
import type {
  DataLayer,
  DelegationTarget,
  DelegationView,
  MemberView,
  Role,
  SchedulingAccessStore,
  SchedulingLevel,
} from '@crm/data';
import { ROLE_LABELS } from '@crm/data';
import { useDelegations } from '@crm/data/react';
import {
  Avatar,
  Button,
  focusLater,
  Icon,
  Popover,
  Select,
  SettingsRow,
  Skeleton,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { memo, useEffect, useRef, useState } from 'react';
import { useMyAccess } from '../workspace/WorkspacePage.tsx';
import {
  LevelControl,
  LevelSelect,
  personItem,
  RemoveAccessDialog,
  type RemoveAccessQuestion,
} from './SchedulingAccessDialogs.tsx';
import {
  heldBy,
  reachWords,
  roleManagesEveryone,
  sourceOf,
  targetName,
  whoseOf,
  type NameOf,
} from './scheduling-access.ts';
import { strings } from './scheduling-access-strings.ts';

/** The column, for holders of `members.manage` (AC-1267): its header names its subject (timefix's lesson). */
export const SCHEDULING_ACCESS_COLUMN: TableColumn = { id: 'scheduling', label: strings.column };

/** Props for one member's cell. */
export interface SchedulingAccessCellProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  /** The reader's own member id: a grant shows in their own Scheduling access page too when it names them. */
  readonly me: string;
  readonly member: MemberView;
}

/** The value Everyone takes in the target picker; a person's is their id. */
const EVERYONE = '@everyone';

/**
 * The workspace's members, for names and the person picker: the data layer's one cached list (the route loaded it),
 * so this resolves at once and asks the network nothing.
 */
function useMemberList(data: DataLayer, slug: string): readonly MemberView[] {
  const [list, setList] = useState<readonly MemberView[]>([]);
  useEffect(() => {
    let isCurrent = true;
    data.members.list(slug).then(
      (members) => {
        if (isCurrent) setList(members);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug]);
  return list;
}

/**
 * One member's reach as a quiet button with its words ("Sam and Bea", "Only their own"), opening a Popover with the
 * reach from their role, their delegations (each level changes in place, Remove asks first) and Give access. An owner
 * or admin reads "Everyone" as plain text: a control that couldn't change their reach would lie (timefix's rule).
 */
export const SchedulingAccessCell = memo(function SchedulingAccessCell(props: SchedulingAccessCellProps) {
  const store = useStore(props.data);
  if (roleManagesEveryone(props.member.role)) return strings.everyoneByRole;
  // Its place until the store is here: it loads in its own chunk with the first cell, never in the first load.
  if (store === undefined) return <Skeleton width="short" />;
  return <Reach {...props} store={store} />;
});

/** The scheduling access store: at once when a loader opened it, else opened here (its own chunk). */
function useStore(data: DataLayer): SchedulingAccessStore | undefined {
  const [store, setStore] = useState(() => data.scheduling.loaded());
  useEffect(() => {
    if (store !== undefined) return;
    let isCurrent = true;
    data.scheduling.open().then(
      (opened) => {
        if (isCurrent) setStore(opened);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, store]);
  return store;
}

/** A member whose reach comes from their delegations: the words, the popover and the confirm. */
function Reach({
  data,
  store,
  toasts,
  slug,
  me,
  member,
}: SchedulingAccessCellProps & { readonly store: SchedulingAccessStore }) {
  const held = store.delegations(slug, 'everyone');
  const state = useDelegations(held);
  const members = useMemberList(data, slug);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [question, setQuestion] = useState<RemoveAccessQuestion | undefined>(undefined);
  const nameOf: NameOf = (id) => (id === member.id ? member.name : members.find((each) => each.id === id)?.name);

  // Its place while the workspace's delegations load, so the column doesn't fill in late with nothing.
  if (state.status === 'loading') return <Skeleton width="short" />;
  // Never a reach the reader might act on when it wasn't read: say so, and try again from here.
  if (state.status === 'error') {
    return (
      <Button
        variant="ghost"
        icon="refresh-cw"
        label={strings.cellFailedFor(member.name)}
        onPress={() => held.reload()}
      >
        {strings.cellFailed}
      </Button>
    );
  }

  const theirs = heldBy(state.delegations, member.id);
  const words = reachWords(member.role, theirs, nameOf);
  const ask = (delegation: DelegationView) => {
    // The popover closes first, so focus moves into the dialog and nothing is left open behind it.
    setOpen(false);
    setQuestion({
      title: strings.removeTitle(member.name),
      text: strings.removeOver(member.name, whoseOf(delegation.target, nameOf), delegation.level),
      run: () => {
        void store.revoke(slug, me, delegation).then((landed) => {
          if (landed) toasts.toast({ tone: 'success', message: strings.removed });
        });
      },
    });
  };

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        iconRight="chevron-down"
        label={`${strings.cellFor(member.name)}: ${words}`}
        onPress={() => setOpen(true)}
      >
        {words}
      </Button>
      <Popover
        label={strings.cellFor(member.name)}
        triggerRef={triggerRef}
        isOpen={isOpen}
        onOpenChange={setOpen}
        width="panel"
      >
        {/* Mounted only while open: the pickers over every member are built for the one person being edited. */}
        {isOpen && (
          <Editor
            data={data}
            store={store}
            toasts={toasts}
            slug={slug}
            me={me}
            member={member}
            members={members}
            theirs={theirs}
            nameOf={nameOf}
            onRemove={ask}
          />
        )}
      </Popover>
      <RemoveAccessDialog
        question={question}
        onClose={() => {
          setQuestion(undefined);
          focusLater(() => triggerRef.current);
        }}
      />
    </>
  );
}

/** The popover's body: the role's reach, each delegation, and Give access. */
function Editor({
  store,
  toasts,
  slug,
  me,
  member,
  members,
  theirs,
  nameOf,
  onRemove,
}: SchedulingAccessCellProps & {
  readonly store: SchedulingAccessStore;
  readonly members: readonly MemberView[];
  readonly theirs: readonly DelegationView[];
  readonly nameOf: NameOf;
  readonly onRemove: (delegation: DelegationView) => void;
}) {
  const reader = useMyAccess()?.role;
  const [target, setTarget] = useState<string | null>(null);
  const [level, setLevel] = useState<SchedulingLevel>('view');
  const targetRef = useRef<HTMLButtonElement>(null);
  // Whom they may be given (AC-1255): never an owner, an admin only when the reader is an owner, never themself or
  // someone they already have. The server holds the same rules, so nothing offered here is refused.
  const offerable = (role: Role) => role !== 'owner' && (role !== 'admin' || reader === 'owner');
  const people = members.filter(
    (each) =>
      each.id !== member.id &&
      offerable(each.role) &&
      !theirs.some((one) => one.target.type === 'member' && one.target.memberId === each.id),
  );
  const hasEveryone = theirs.some((one) => one.target.type === 'everyone');
  const targets = [
    ...(hasEveryone
      ? []
      : [
          {
            id: EVERYONE,
            label: strings.everyoneOption,
            description: strings.everyoneOptionText,
            leading: <Icon name="users-round" tone="muted" />,
          },
        ]),
    ...people.map(personItem),
  ];
  const grant = (to: DelegationTarget, chosen: SchedulingLevel) => {
    const whose = whoseOf(to, nameOf);
    void store.grant(slug, me, { delegateMemberId: member.id, target: to, level: chosen }).then((landed) => {
      if (landed) toasts.toast({ tone: 'success', message: strings.given(member.name, chosen, whose) });
    });
  };
  const byId = new Map(members.map((each) => [each.id, each]));
  const give = () => {
    if (target === null) return;
    grant(target === EVERYONE ? { type: 'everyone' } : { type: 'member', memberId: target }, level);
    setTarget(null);
    setLevel('view');
    // The button that had focus is disabled now: back to the picker, for the next one.
    focusLater(() => targetRef.current);
  };
  return (
    <>
      <SettingsRow
        leading={<Icon name="shield-check" tone="muted" />}
        leadingAlign="center"
        title={ROLE_LABELS[member.role]}
        description={theirs.length === 0 ? strings.roleOwnOnly : strings.roleOwn}
      />
      {theirs.map((delegation) => {
        const name = targetName(delegation.target, nameOf);
        const found = delegation.target.type === 'member' ? byId.get(delegation.target.memberId) : undefined;
        return (
          <SettingsRow
            key={delegation.id}
            leading={
              delegation.target.type === 'member' ? (
                <Avatar
                  name={name}
                  id={delegation.target.memberId}
                  size="sm"
                  {...(found?.avatarUrl === undefined ? {} : { src: found.avatarUrl })}
                  isDecorative
                />
              ) : (
                <Icon name="users-round" tone="muted" />
              )
            }
            leadingAlign="center"
            title={name}
            description={sourceOf(delegation, me, nameOf)}
          >
            <LevelSelect
              name={`${member.name}: ${name}`}
              value={delegation.level}
              onChange={(next) => grant(delegation.target, next)}
            />
            <Button
              variant="ghost"
              icon="x"
              label={strings.removeFor(`${member.name}: ${name}`)}
              onPress={() => onRemove(delegation)}
            />
          </SettingsRow>
        );
      })}
      {targets.length > 0 && (
        // Give access: whose scheduling, then See or Manage and the button, as two more rows of the panel, so the
        // hairline and the rows' own padding set it apart from the delegations above.
        <>
          <SettingsRow title={strings.letFor(member.name)} control="field">
            <Select
              label={strings.letFor(member.name)}
              isLabelHidden
              placeholder={strings.targetPlaceholder}
              items={targets}
              value={target}
              onChange={setTarget}
              isSearchable
              triggerRef={targetRef}
            />
          </SettingsRow>
          <SettingsRow title={strings.level}>
            <LevelControl
              value={level}
              onChange={setLevel}
              label={strings.levelFor(member.name)}
              isLabelVisible={false}
            />
            <Button variant="primary" isDisabled={target === null} onPress={give}>
              {strings.give}
            </Button>
          </SettingsRow>
        </>
      )}
    </>
  );
}
