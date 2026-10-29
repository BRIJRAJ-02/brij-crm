// Brief
// Purpose: Settings › Account › Scheduling access (spec 0037, AC-1266): who can see or manage my scheduling, and whose
// I can reach, timefix's "Sees all calendars" made personal (decision 9: a member picks their own assistant).
// Main task: add a colleague with See or Manage, change their level, or take it back (asked first, AC-1445).
// Leaves out: teams (not built), roles (Settings › Members), the reach of other people (the Members page's column).
import type { DataLayer, DelegationView, MemberView, MyAccess, SchedulingLevel } from '@crm/data';
import { ROLE_LABELS } from '@crm/data';
import { useDelegations } from '@crm/data/react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Select,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type Toasts,
} from '@crm/ui';
import { useMemo, useState } from 'react';
import { AddDelegateDialog, RemoveAccessDialog, type RemoveAccessQuestion } from './SchedulingAccessDialogs.tsx';
import { heldBy, overMe, roleManagesEveryone, sourceOf, targetName, whoseOf } from './scheduling-access.ts';
import { strings } from './scheduling-access-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for the page: what its route loaded. */
export interface SchedulingAccessScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly access: MyAccess;
  /** The workspace's active members, for names, pictures and the Add someone picker. */
  readonly members: readonly MemberView[];
}

/** See or Manage as one quiet inline Select in a row. */
function LevelSelect({
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

/** A level as a quiet word, for a row that can't change it here. */
const levelBadge = (level: SchedulingLevel) => (
  <Badge text={level === 'manage' ? strings.manage : strings.see} isWhole />
);

/** Settings › Account › Scheduling access. */
export function SchedulingAccessScreen({ data, toasts, slug, access, members }: SchedulingAccessScreenProps) {
  const me = access.memberId;
  const state = useDelegations(data.scheduling.delegations(slug, 'mine'));
  const [isAdding, setAdding] = useState(false);
  const [question, setQuestion] = useState<RemoveAccessQuestion | undefined>(undefined);
  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const nameOf = (id: string) => byId.get(id)?.name;
  const delegations = state.status === 'ready' ? state.delegations : [];
  const over = overMe(delegations, me);
  const held = heldBy(delegations, me);
  // Owners and admins manage everyone through their role (decision 7), so they never need adding.
  const addable = members.filter(
    (member) =>
      member.id !== me &&
      !roleManagesEveryone(member.role) &&
      !over.some((each) => each.delegateMemberId === member.id),
  );
  const hoursSetByOthers = !access.permissions.includes('availability.own');

  const grant = (delegateMemberId: string, level: SchedulingLevel, isChange: boolean) => {
    const name = nameOf(delegateMemberId) ?? strings.formerMember;
    void data.scheduling
      .grant(slug, me, { delegateMemberId, target: { type: 'member', memberId: me }, level })
      .then((landed) => {
        if (landed)
          toasts.toast({ tone: 'success', message: (isChange ? strings.changed : strings.added)(name, level) });
      });
  };
  const revoke = (delegation: DelegationView) => {
    void data.scheduling.revoke(slug, me, delegation).then((landed) => {
      if (landed) toasts.toast({ tone: 'success', message: strings.removed });
    });
  };

  const person = (memberId: string) => {
    const member = byId.get(memberId);
    return (
      <Avatar
        name={member?.name ?? strings.formerMember}
        id={memberId}
        size="sm"
        {...(member?.avatarUrl === undefined ? {} : { src: member.avatarUrl })}
        isDecorative
      />
    );
  };

  let overBody;
  let heldBody;
  if (state.status === 'error') {
    const failed = (
      <EmptyState
        tone="error"
        title={strings.loadFailed}
        onRetry={() => data.scheduling.delegations(slug, 'mine').reload()}
      >
        {state.error.message}
      </EmptyState>
    );
    overBody = failed;
    heldBody = null;
  } else if (state.status === 'loading') {
    overBody = <SchedulingAccessLoadingCard />;
    heldBody = <SchedulingAccessLoadingCard />;
  } else {
    overBody = (
      <Card>
        {/* Owners and admins reach everyone through their role: said once, read only (timefix's "Yes"). */}
        <SettingsRow
          leading={<Icon name="shield-check" tone="muted" />}
          leadingAlign="center"
          title={strings.ownersAndAdmins}
          description={strings.ownersAndAdminsSource}
        >
          {levelBadge('manage')}
        </SettingsRow>
        {over.map((delegation) => {
          const name = nameOf(delegation.delegateMemberId) ?? strings.formerMember;
          return (
            <SettingsRow
              key={delegation.id}
              leading={person(delegation.delegateMemberId)}
              leadingAlign="center"
              title={name}
              description={sourceOf(delegation, me, nameOf)}
            >
              <LevelSelect
                name={name}
                value={delegation.level}
                onChange={(level) => grant(delegation.delegateMemberId, level, true)}
              />
              <Button
                variant="ghost"
                icon="x"
                label={strings.removeFor(name)}
                onPress={() =>
                  setQuestion({
                    title: strings.removeTitle(name),
                    text: strings.removeOverMe(name, delegation.level),
                    run: () => revoke(delegation),
                  })
                }
              />
            </SettingsRow>
          );
        })}
        {over.length === 0 && <EmptyState layout="row" icon="users" title={strings.nobodyOverMe} />}
      </Card>
    );
    const roleReach = roleManagesEveryone(access.role);
    heldBody = (
      <Card>
        {roleReach && (
          <SettingsRow
            leading={<Icon name="users-round" tone="muted" />}
            leadingAlign="center"
            title={strings.everyone}
            description={strings.everyoneFromRole(ROLE_LABELS[access.role])}
          >
            {levelBadge('manage')}
          </SettingsRow>
        )}
        {held.map((delegation) => {
          const name = targetName(delegation.target, nameOf);
          const whose = whoseOf(delegation.target, nameOf);
          return (
            <SettingsRow
              key={delegation.id}
              leading={
                delegation.target.type === 'member' ? (
                  person(delegation.target.memberId)
                ) : (
                  <Icon name="users-round" tone="muted" />
                )
              }
              leadingAlign="center"
              title={name}
              description={sourceOf(delegation, me, nameOf)}
            >
              {levelBadge(delegation.level)}
              {/* A delegate may give back their own access (AC-1255). */}
              <Button
                variant="ghost"
                icon="x"
                label={strings.removeFor(name)}
                onPress={() =>
                  setQuestion({
                    title: strings.giveUpTitle(whose),
                    text: strings.removeMine(whose, delegation.level),
                    run: () => revoke(delegation),
                  })
                }
              />
            </SettingsRow>
          );
        })}
        {!roleReach && held.length === 0 && (
          <EmptyState layout="row" icon="calendar-clock" title={strings.onlyYours}>
            {strings.onlyYoursText}
          </EmptyState>
        )}
      </Card>
    );
  }

  return (
    <SettingsPage
      title={strings.title}
      actions={
        <Button
          variant="primary"
          icon="user-plus"
          isDisabled={state.status !== 'ready'}
          onPress={() => setAdding(true)}
        >
          {strings.addSomeone}
        </Button>
      }
    >
      <SettingsSection title={strings.overMe} description={strings.overMeDescription}>
        {overBody}
      </SettingsSection>
      {heldBody !== null && (
        <SettingsSection title={strings.mine} description={strings.mineDescription}>
          {heldBody}
        </SettingsSection>
      )}
      <AddDelegateDialog
        isOpen={isAdding}
        people={addable}
        hoursSetByOthers={hoursSetByOthers}
        onClose={() => setAdding(false)}
        onAdd={(memberId, level) => grant(memberId, level, false)}
      />
      <RemoveAccessDialog question={question} onClose={() => setQuestion(undefined)} />
    </SettingsPage>
  );
}

/** A section's card while the delegations load: two rows' shape. */
function SchedulingAccessLoadingCard() {
  return (
    <Card isBusy>
      <SettingsRow title="" leading={<Skeleton shape="circle" />}>
        <Skeleton width="short" />
      </SettingsRow>
      <SettingsRow title="" leading={<Skeleton shape="circle" />}>
        <Skeleton width="short" />
      </SettingsRow>
    </Card>
  );
}

/** The page while its route loads: the two sections in their loading shape. */
export function SchedulingAccessLoading() {
  return (
    <>
      <SettingsSection title={strings.overMe} description={strings.overMeDescription}>
        <SchedulingAccessLoadingCard />
      </SettingsSection>
      <SettingsSection title={strings.mine} description={strings.mineDescription}>
        <SchedulingAccessLoadingCard />
      </SettingsSection>
    </>
  );
}
