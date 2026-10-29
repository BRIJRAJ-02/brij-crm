// Brief
// Purpose: the Members page's Scheduling access cell (spec 0037, AC-1267, decision 8): timefix's "Sees all calendars"
// switch widened, for holders of `members.manage`: whose scheduling each person may see or manage beyond their own.
// Main task: read each person's reach in a few words; open it to give them See or Manage over a person or everyone,
// change a level, or take one back (asked first, AC-1445).
// Leaves out: teams (not built), reach from custom roles (not built), "What can Priya do" (the role guide's).
import type { DataLayer, DelegationTarget, DelegationView, MemberView, SchedulingLevel } from '@crm/data';
import { ROLE_LABELS } from '@crm/data';
import { useDelegations } from '@crm/data/react';
import { Button, EmptyState, Icon, Popover, Select, SettingsRow, type TableColumn, type Toasts } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { LevelControl, personItem, RemoveAccessDialog, type RemoveAccessQuestion } from './SchedulingAccessDialogs.tsx';
import { heldBy, reachWords, roleManagesEveryone, targetName, whoseOf } from './scheduling-access.ts';
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
 * read once per cell.
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
export function SchedulingAccessCell({ data, toasts, slug, me, member }: SchedulingAccessCellProps) {
  const held = data.scheduling.delegations(slug, 'everyone');
  const state = useDelegations(held);
  const members = useMemberList(data, slug);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [question, setQuestion] = useState<RemoveAccessQuestion | undefined>(undefined);
  const [target, setTarget] = useState<string | null>(null);
  const [level, setLevel] = useState<SchedulingLevel>('view');
  const nameOf = (id: string) => (id === member.id ? member.name : members.find((each) => each.id === id)?.name);

  if (roleManagesEveryone(member.role)) return strings.everyoneByRole;
  if (state.status === 'loading') return null;
  if (state.status === 'error') return strings.theirs;

  const theirs = heldBy(state.delegations, member.id);
  const words = reachWords(member.role, theirs, nameOf);
  // Whom they may be given: everyone, or a member who isn't them, isn't an owner or admin unless the reader is an
  // owner (the server says so either way), and isn't already in their list.
  const people = members.filter(
    (each) =>
      each.id !== member.id && !theirs.some((one) => one.target.type === 'member' && one.target.memberId === each.id),
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
    void data.scheduling.grant(slug, me, { delegateMemberId: member.id, target: to, level: chosen }).then((landed) => {
      if (landed) toasts.toast({ tone: 'success', message: strings.given(member.name, chosen, whose) });
    });
  };
  const ask = (delegation: DelegationView) => {
    // The popover closes first, so focus moves into the dialog and nothing is left open behind it.
    setOpen(false);
    setQuestion({
      title: strings.removeTitle(member.name),
      text: strings.removeOver(member.name, whoseOf(delegation.target, nameOf), delegation.level),
      run: () => {
        void data.scheduling.revoke(slug, me, delegation).then((landed) => {
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
        width="builder"
      >
        <SettingsRow
          leading={<Icon name="shield-check" tone="muted" />}
          leadingAlign="center"
          title={ROLE_LABELS[member.role]}
          description={strings.roleOwnOnly}
        />
        {theirs.map((delegation) => {
          const name = targetName(delegation.target, nameOf);
          return (
            <SettingsRow key={delegation.id} title={name} leadingAlign="center">
              <Select
                label={strings.levelFor(name)}
                isLabelHidden
                variant="inline"
                items={[
                  { id: 'view', label: strings.see },
                  { id: 'manage', label: strings.manage },
                ]}
                value={delegation.level}
                onChange={(next) => {
                  if ((next === 'view' || next === 'manage') && next !== delegation.level)
                    grant(delegation.target, next);
                }}
              />
              <Button
                variant="ghost"
                icon="x"
                label={strings.removeFor(`${member.name}: ${name}`)}
                onPress={() => ask(delegation)}
              />
            </SettingsRow>
          );
        })}
        {theirs.length === 0 && <EmptyState layout="row" icon="calendar-clock" title={strings.theirs} />}
        {targets.length > 0 && (
          <SettingsRow title={strings.addFor} control="field">
            <Select
              label={strings.target}
              isLabelHidden
              placeholder={strings.targetPlaceholder}
              items={targets}
              value={target}
              onChange={setTarget}
              isSearchable
            />
            <LevelControl
              value={level}
              onChange={setLevel}
              label={strings.levelFor(member.name)}
              isLabelVisible={false}
            />
            <Button
              variant="primary"
              isDisabled={target === null}
              onPress={() => {
                if (target === null) return;
                grant(target === EVERYONE ? { type: 'everyone' } : { type: 'member', memberId: target }, level);
                setTarget(null);
                setLevel('view');
              }}
            >
              {strings.give}
            </Button>
          </SettingsRow>
        )}
      </Popover>
      <RemoveAccessDialog
        question={question}
        onClose={() => {
          setQuestion(undefined);
          triggerRef.current?.focus();
        }}
      />
    </>
  );
}
