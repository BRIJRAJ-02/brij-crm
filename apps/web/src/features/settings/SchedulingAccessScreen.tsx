// Brief
// Purpose: Settings › Account › Scheduling access (spec 0037, AC-1266): who can see or manage my scheduling, and whose
// I can reach, timefix's "Sees all calendars" made personal (decision 9: a member picks their own assistant).
// Main task: add a colleague with See or Manage, change their level, or take it back (asked first, AC-1445).
// Leaves out: team leads' reach (custom roles), roles (Settings › Members), the reach of other people (the Members page's column).
import type { DelegationView, MemberView, MyAccess, SchedulingAccessStore, SchedulingLevel, TeamView } from '@crm/data';
import { ROLE_LABELS } from '@crm/data';
import { useScheduling } from '@crm/data/react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  focusLater,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type Toasts,
} from '@crm/ui';
import { useMemo, useRef, useState } from 'react';
import {
  AddDelegateDialog,
  LevelSelect,
  RemoveAccessDialog,
  type RemoveAccessQuestion,
} from './SchedulingAccessDialogs.tsx';
import { heldBy, overMe, roleManagesEveryone, sourceOf, targetName, whoseOf } from './scheduling-access.ts';
import { strings } from './scheduling-access-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for the page: what its route loaded. */
export interface SchedulingAccessScreenProps {
  /** The scheduling access store, which the route's loader opened. */
  readonly scheduling: SchedulingAccessStore;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly access: MyAccess;
  /** The workspace's active members, for names, pictures and the Add someone picker. */
  readonly members: readonly MemberView[];
  /** The workspace's teams, for the names of team delegations (spec 0037, AC-1254). */
  readonly teams?: readonly TeamView[];
}

/** A level as a quiet word, for a row that can't change it here. */
const levelBadge = (level: SchedulingLevel) => (
  <Badge text={level === 'manage' ? strings.manage : strings.see} isWhole />
);

/** Settings › Account › Scheduling access. */
export function SchedulingAccessScreen({
  scheduling,
  toasts,
  slug,
  access,
  members,
  teams = [],
}: SchedulingAccessScreenProps) {
  const me = access.memberId;
  const state = useScheduling(scheduling.delegations(slug, 'mine'));
  const [isAdding, setAdding] = useState(false);
  const [question, setQuestion] = useState<RemoveAccessQuestion | undefined>(undefined);
  // Where focus goes once a confirm or the Add dialog closes: the row it came from may be gone.
  const addRef = useRef<HTMLButtonElement>(null);
  const refocus = () => focusLater(() => addRef.current);
  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const nameOf = (id: string) => byId.get(id)?.name;
  const teamOf = (id: string) => teams.find((team) => team.id === id)?.name;
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
    void scheduling
      .grant(slug, me, { delegateMemberId, target: { type: 'member', memberId: me }, level })
      .then((landed) => {
        if (landed)
          toasts.toast({ tone: 'success', message: (isChange ? strings.changed : strings.added)(name, level) });
      });
  };
  const revoke = (delegation: DelegationView) => {
    void scheduling.revoke(slug, me, delegation).then((landed) => {
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
      <EmptyState tone="error" title={strings.loadFailed} onRetry={() => scheduling.delegations(slug, 'mine').reload()}>
        {state.error.message}
      </EmptyState>
    );
    overBody = <Card>{failed}</Card>;
    heldBody = <Card>{failed}</Card>;
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
            leading={<Icon name="users" tone="muted" />}
            leadingAlign="center"
            title={strings.everyone}
            description={strings.everyoneFromRole(ROLE_LABELS[access.role])}
          >
            {levelBadge('manage')}
          </SettingsRow>
        )}
        {held.map((delegation) => {
          const name = targetName(delegation.target, nameOf, teamOf);
          const whose = whoseOf(delegation.target, nameOf, teamOf);
          return (
            <SettingsRow
              key={delegation.id}
              leading={
                delegation.target.type === 'member' ? (
                  person(delegation.target.memberId)
                ) : (
                  <Icon name={delegation.target.type === 'team' ? 'users-round' : 'users'} tone="muted" />
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
        {!roleReach && held.length === 0 && <EmptyState layout="row" icon="calendar-clock" title={strings.onlyYours} />}
      </Card>
    );
  }

  return (
    <SettingsPage title={strings.title}>
      <SettingsSection
        title={strings.overMe}
        description={strings.overMeDescription}
        // The page's one primary, on the section it adds to, so it is there on every width.
        actions={
          <Button
            ref={addRef}
            variant="primary"
            icon="user-plus"
            isDisabled={state.status !== 'ready'}
            onPress={() => setAdding(true)}
          >
            {strings.addSomeone}
          </Button>
        }
      >
        {overBody}
      </SettingsSection>
      <SettingsSection title={strings.mine} description={strings.mineDescription}>
        {heldBody}
      </SettingsSection>
      <AddDelegateDialog
        isOpen={isAdding}
        people={addable}
        hoursSetByOthers={hoursSetByOthers}
        onClose={() => {
          setAdding(false);
          refocus();
        }}
        onAdd={(memberId, level) => grant(memberId, level, false)}
      />
      <RemoveAccessDialog
        question={question}
        onClose={() => {
          setQuestion(undefined);
          refocus();
        }}
      />
    </SettingsPage>
  );
}

/** A section's card while the delegations load: two rows' shape. */
function SchedulingAccessLoadingCard() {
  return (
    <Card isBusy>
      {[0, 1].map((row) => (
        <SettingsRow key={row} title="" leading={<Skeleton shape="circle" />} description={<Skeleton width="medium" />}>
          <Skeleton width="short" />
        </SettingsRow>
      ))}
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
