// Brief
// Purpose: "What can Priya do" (spec 0037, AC-1243): one person's role, what it lets them do, and their scheduling
// reach both ways, on the Members page.
// Main task: read it at a glance: the role's areas (All, Some, None) and three short lines on scheduling.
// Leaves out: changing any of it (the role's page, the Scheduling column), and object, field and record rules.
import {
  EVERYONE_CAN,
  powersOf,
  type DataLayer,
  type DelegationView,
  type MemberView,
  type RoleDefinition,
  type SchedulingAccessStore,
} from '@crm/data';
import { useScheduling } from '@crm/data/react';
import { Badge, Button, ButtonLink, Callout, DescriptionList, EmptyState, Modal, RolePowers, Skeleton } from '@crm/ui';
import { useEffect, useState } from 'react';
import { managedBy, reachLine, type CapabilityWords, type NameOf } from './capabilities.ts';
import { roleHref } from './nav.ts';
import { strings } from './members-strings.ts';
import { strings as roleStrings } from './roles-strings.ts';

/** Props for the dialog. */
export interface CapabilitiesDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The person asked about; undefined while closed. */
  readonly member: MemberView | undefined;
  /** Every role (`roles.overview`). */
  readonly roles: readonly RoleDefinition[];
  /** Everyone, for names. */
  readonly members: readonly MemberView[];
  /** The reader holds `members.manage`: the workspace's delegations; else their own. */
  readonly readsEveryone: boolean;
  readonly onClose: () => void;
}

const WORDS: CapabilityWords = {
  reach: roleStrings.reach,
  and: strings.capabilities.and,
  ownersAndAdmins: strings.capabilities.ownersAndAdmins,
  holdersOf: strings.capabilities.holdersOf,
  teamHoldersOf: strings.capabilities.teamHoldersOf,
  everyoneGrant: strings.capabilities.everyoneGrant,
};

/** A Modal with the person's role, its powers by area, and their scheduling reach. */
export function CapabilitiesDialog({ member, ...props }: CapabilitiesDialogProps) {
  // The last person stays while the Modal plays its exit.
  const [last, setLast] = useState(member);
  if (member !== undefined && member !== last) setLast(member);
  const shown = member ?? last;
  return shown === undefined ? null : <Shown {...props} member={shown} isOpen={member !== undefined} />;
}

function Shown({
  data,
  slug,
  member,
  roles,
  members,
  readsEveryone,
  isOpen,
  onClose,
}: Omit<CapabilitiesDialogProps, 'member'> & { readonly member: MemberView; readonly isOpen: boolean }) {
  const role = roles.find((each) => each.id === (member.customRoleId ?? member.role));
  const first = member.name.trim().split(/\s+/)[0] ?? member.name;
  return (
    <Modal
      title={strings.capabilities.title(first)}
      variant="window"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      {...(role === undefined ? {} : { context: <Badge text={role.label} isWhole /> })}
      actions={
        <>
          {/* A guest has no Roles page to open (it is not for guests). */}
          {role !== undefined && member.role !== 'guest' && (
            <ButtonLink href={roleHref(slug, role.id)} icon="arrow-right">
              {strings.capabilities.openRole}
            </ButtonLink>
          )}
          <Button variant="primary" slot="close">
            {strings.done}
          </Button>
        </>
      }
    >
      {role === undefined ? (
        // A role the reader can't name (one deleted since the page loaded): said, never a skeleton left spinning.
        <EmptyState icon="id-card" title={strings.capabilities.unread} />
      ) : (
        <>
          <RolePowers
            label={strings.rolePowers(role.label)}
            summary={role.dataAccess === 'read' ? strings.capabilities.readOnly : EVERYONE_CAN}
            areas={powersOf(role.permissions).map((each) => ({
              id: each.area.id,
              title: each.area.title,
              standing: each.standing,
              held: each.held,
              withheld: each.withheld,
            }))}
          />
          {member.role !== 'guest' && (
            <Scheduling
              data={data}
              slug={slug}
              member={member}
              role={role}
              roles={roles}
              members={members}
              readsEveryone={readsEveryone}
            />
          )}
        </>
      )}
    </Modal>
  );
}

/** The three scheduling lines: whom they see, whom they manage, and who manages them. */
function Scheduling({
  data,
  slug,
  member,
  role,
  roles,
  members,
  readsEveryone,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly member: MemberView;
  readonly role: RoleDefinition;
  readonly roles: readonly RoleDefinition[];
  readonly members: readonly MemberView[];
  readonly readsEveryone: boolean;
}) {
  const store = useStore(data);
  if (store === 'failed') return <Callout tone="danger">{strings.capabilities.unread}</Callout>;
  if (store === undefined) return <Skeleton width="long" />;
  return (
    <Lines
      store={store}
      slug={slug}
      member={member}
      role={role}
      roles={roles}
      members={members}
      readsEveryone={readsEveryone}
    />
  );
}

function Lines({
  store,
  slug,
  member,
  role,
  roles,
  members,
  readsEveryone,
}: {
  readonly store: SchedulingAccessStore;
  readonly slug: string;
  readonly member: MemberView;
  readonly role: RoleDefinition;
  readonly roles: readonly RoleDefinition[];
  readonly members: readonly MemberView[];
  readonly readsEveryone: boolean;
}) {
  const state = useScheduling(store.delegations(slug, readsEveryone ? 'everyone' : 'mine'));
  if (state.status === 'loading') return <Skeleton width="long" />;
  // Never a reach worked out from delegations that weren't read.
  if (state.status === 'error') return <Callout tone="danger">{strings.capabilities.unread}</Callout>;
  const delegations: readonly DelegationView[] = state.status === 'ready' ? state.delegations : [];
  const nameOf: NameOf = (id) => members.find((each) => each.id === id)?.name;
  const held = delegations.filter((each) => each.delegateMemberId === member.id);
  return (
    <DescriptionList
      layout="columns"
      items={[
        { id: 'sees', term: strings.capabilities.sees, description: reachLine(role, held, 'view', nameOf, WORDS) },
        {
          id: 'manages',
          term: strings.capabilities.manages,
          description: reachLine(role, held, 'manage', nameOf, WORDS),
        },
        {
          id: 'managed',
          term: strings.capabilities.managedBy,
          description: managedBy(member, roles, delegations, nameOf, WORDS).join(', '),
        },
      ]}
    />
  );
}

/** The scheduling access store: at once when a loader opened it, else opened here (its own chunk). */
function useStore(data: DataLayer): SchedulingAccessStore | 'failed' | undefined {
  const [store, setStore] = useState<SchedulingAccessStore | 'failed' | undefined>(() => data.scheduling.loaded());
  useEffect(() => {
    if (store !== undefined) return;
    let isCurrent = true;
    data.scheduling.open().then(
      (opened) => {
        if (isCurrent) setStore(opened);
      },
      () => {
        if (isCurrent) setStore('failed');
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, store]);
  return store;
}
