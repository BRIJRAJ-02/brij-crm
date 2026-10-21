// Brief
// Purpose: Settings › Workspace › Members (spec 0031, AC-803, AC-810, AC-811): who is in the workspace, what each can
// do, and who is invited.
// Main task: find someone by name or email; owners and admins change roles, remove people and invite, resend or
// revoke invitations; an owner hands the workspace on; everyone reads who is in.
// Leaves out: leaving (the workspace menu's), the removal's effects and reassignment (slice 5),
// teams, guests, the invite link and email domains (later slices).
import {
  isDataError,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
  type DataLayer,
  type InvitationView,
  type InviteLinkView,
  type JoinRequestView,
  type WorkspaceDomainsView,
  type MembersPage,
  type MemberView,
  type MyAccess,
  type Role,
  type RolesList,
} from '@crm/data';
import {
  Avatar,
  Badge,
  Button,
  ButtonGroup,
  Callout,
  EmptyState,
  Field,
  InfoTip,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  RelativeTime,
  Select,
  SettingsStack,
  Table,
  TabPanel,
  Tabs,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { Fragment, useEffect, useState } from 'react';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import { EmailDomainCard } from './EmailDomainCard.tsx';
import { InviteLinkCard } from './InviteLinkCard.tsx';
import { MemberConfirm, type MemberQuestion } from './MemberConfirm.tsx';
import { RemoveMemberDialog } from './RemoveMemberDialog.tsx';
import { canRemove, grantableRoles, invitableRoles } from './members.ts';
import { strings } from './members-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for the Members page: what its route loaded through the data layer. */
export interface MembersScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  /** The workspace's name, for the confirms ("Remove Grace Hopper from Acme?"). */
  readonly workspaceName: string;
  /** The first page of members, for `search`. */
  readonly page: MembersPage;
  /** What the list is searched by (`?q=`), empty for everyone. */
  readonly search: string;
  /** Searches again (the route reads `?q=` and loads that page). */
  readonly onSearch: (search: string) => void;
  /** The open invitations; undefined for someone who can't invite (no tab at all). */
  readonly invitations: readonly InvitationView[] | undefined;
  /** The invite link, for holders of `members.invite` (with the invitations). */
  readonly link?: InviteLinkView | undefined;
  /** Open requests to join, for holders of `members.invite`; the tab shows only while any wait. */
  readonly requests?: readonly JoinRequestView[] | undefined;
  /** The email domains, for holders of `workspace.manage`. */
  readonly domains?: WorkspaceDomainsView | undefined;
  readonly access: MyAccess;
  /** The roles every role picker offers (`roles.list`, spec 0037, AC-1439), most power first. */
  readonly roles: RolesList;
}

const MEMBER_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.columns.name, isRowHeader: true, isInline: true },
  { id: 'email', label: strings.columns.email },
  {
    id: 'role',
    label: strings.columns.role,
    info: (
      <InfoTip label={strings.columns.role}>
        {ROLES.map((role, index) => (
          <Fragment key={role}>
            {index > 0 && <br />}
            {ROLE_LABELS[role]}: {ROLE_DESCRIPTIONS[role]}
          </Fragment>
        ))}
      </InfoTip>
    ),
  },
  { id: 'joined', label: strings.columns.joined },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

const REQUEST_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.columns.name, isRowHeader: true, isInline: true },
  { id: 'email', label: strings.columns.email },
  { id: 'requested', label: strings.requested },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

const INVITATION_COLUMNS: readonly TableColumn[] = [
  { id: 'email', label: strings.columns.email, isRowHeader: true },
  { id: 'role', label: strings.columns.role },
  { id: 'invitedBy', label: strings.columns.invitedBy },
  { id: 'expires', label: strings.columns.expires },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

/** How long the search waits after the last key before it asks again. */
const SEARCH_WAIT_MS = 250;

/** The message a refusal shows, in the server's words when it gave any. */
const messageOf = (error: unknown) => (isDataError(error) ? error.message : strings.somethingWrong);

/** The Members page: Members and Invitations tabs, the Invite dialog and the confirms. */
export function MembersScreen({
  data,
  toasts,
  slug,
  workspaceName,
  page,
  search,
  onSearch,
  invitations,
  link,
  requests = [],
  domains,
  access,
  roles,
}: MembersScreenProps) {
  const router = useRouter();
  const [isInviting, setInviting] = useState(false);
  // The request being approved: its Approve spins and its Decline waits, so one press makes one decision.
  const [approving, setApproving] = useState<string | undefined>(undefined);
  // The tab shown: the search belongs to the Members tab alone.
  const [tab, setTab] = useState('members');
  // The invitations whose Resend is on its way: their row's menu waits for the answer.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // The change the page is asking about, if any, and what to say once it is done.
  const [question, setQuestion] = useState<(MemberQuestion & { readonly done: string }) | undefined>(undefined);
  // The member the remove dialog asks about, if any (it reads what their removal does, AC-816).
  const [removing, setRemoving] = useState<MemberView | undefined>(undefined);
  // A role shown at once while its change is sent, put back if the server refuses (by member id).
  const [pendingRoles, setPendingRoles] = useState<ReadonlyMap<string, Role>>(new Map());
  // The search as typed; the route searches once typing pauses.
  const [typed, setTyped] = useState(search);
  // Pages after the first, as Show more read them, kept with the first page they follow: a new first page (another
  // search, a live reload) starts over from it.
  const [more, setMore] = useState<{
    readonly from: MembersPage;
    readonly members: readonly MemberView[];
    readonly cursor: string | undefined;
  }>({ from: page, members: [], cursor: page.nextCursor });
  const [isLoadingMore, setLoadingMore] = useState(false);
  // Another admin's change, or someone joining, reads the list again and the route reloads (the live `members` event).
  useEffect(() => data.members.watch(slug), [data, slug]);
  useEffect(() => {
    if (typed.trim() === search) return;
    const wait = setTimeout(() => {
      onSearch(typed.trim());
    }, SEARCH_WAIT_MS);
    return () => {
      clearTimeout(wait);
    };
  }, [typed, search, onSearch]);

  const reload = () => router.invalidate();
  const actor = access.role;
  const canInvite = invitations !== undefined && access.permissions.includes('members.invite');
  // The roles list's options this person may invite as, or give a member: the owner rules, as the server keeps them.
  const optionsFor = (allowed: readonly Role[]) =>
    roles.roles.filter((option) => option.builtIn !== undefined && allowed.includes(option.builtIn));
  const inviteRoles = optionsFor(invitableRoles(actor));
  /** A role's name as the roles list says it. */
  const labelOf = (role: Role) => roles.roles.find((option) => option.builtIn === role)?.label ?? ROLE_LABELS[role];
  const held = more.from === page ? more : { from: page, members: [], cursor: page.nextCursor };
  const rows = [...page.members, ...held.members];

  const showMore = () => {
    const { cursor } = held;
    if (cursor === undefined || isLoadingMore) return;
    setLoadingMore(true);
    data.members.page(slug, { search, cursor }).then(
      (read) => {
        setLoadingMore(false);
        setMore({ from: page, members: [...held.members, ...read.members], cursor: read.nextCursor });
      },
      (error: unknown) => {
        setLoadingMore(false);
        toasts.toast({ tone: 'danger', message: messageOf(error) });
      },
    );
  };

  const settleRole = (memberId: string) => {
    setPendingRoles((pending) => {
      const after = new Map(pending);
      after.delete(memberId);
      return after;
    });
  };

  // Someone else's role changes at once and goes back, with the server's reason, if it refuses.
  const changeRole = (member: MemberView, role: Role) => {
    setPendingRoles((pending) => new Map(pending).set(member.id, role));
    data.members.setRole(slug, member.id, role).then(
      async () => {
        await reload();
        settleRole(member.id);
        toasts.toast({ tone: 'success', message: strings.roleChanged(member.name, labelOf(role)) });
      },
      (error: unknown) => {
        settleRole(member.id);
        toasts.toast({ tone: 'danger', message: messageOf(error) });
      },
    );
  };

  const askRole = (member: MemberView, role: Role) => {
    if (role === member.role) return;
    if (member.id !== access.memberId) {
      changeRole(member, role);
      return;
    }
    // Lowering one's own role asks first: it may take away what lets them change it back (AC-811).
    setQuestion({
      title: strings.selfRoleTitle(labelOf(role)),
      text: strings.selfRoleText,
      action: strings.selfRoleAction,
      run: async () => {
        await data.members.setRole(slug, member.id, role);
      },
      done: strings.roleChanged(member.name, labelOf(role)),
    });
  };

  // Handing the workspace on can't be taken back in one click, so it asks first (AC-813).
  const transfer = (member: MemberView) => {
    setQuestion({
      title: strings.transferTitle(member.name, workspaceName),
      text: strings.transferText,
      action: strings.transferAction,
      run: () => data.members.transferOwnership(slug, member.id),
      done: strings.transferred(member.name),
    });
  };

  const remove = (member: MemberView) => {
    setRemoving(member);
  };

  // The dialog says who was invited; the Invitations tab reads them in behind it.
  const invited = () => {
    void reload();
  };

  /** Runs one invitation's Resend, its row's menu waiting until the answer, then says how it went. */
  const act = (
    invitation: InvitationView,
    work: () => Promise<{ readonly tone: 'success' | 'danger'; readonly message: string }>,
  ) => {
    if (busy.has(invitation.id)) return;
    setBusy((pending) => new Set(pending).add(invitation.id));
    const settle = () => {
      setBusy((pending) => {
        const after = new Set(pending);
        after.delete(invitation.id);
        return after;
      });
    };
    work().then(
      async (said) => {
        await reload();
        settle();
        toasts.toast(said);
      },
      (error: unknown) => {
        settle();
        toasts.toast({ tone: 'danger', message: messageOf(error) });
      },
    );
  };

  const resend = (invitation: InvitationView) => {
    act(invitation, async () => {
      const { sent } = await data.invitations.resend(slug, invitation.id);
      // A renewed invitation whose email didn't go out stands, with its new link; Resend tries again.
      return sent
        ? { tone: 'success', message: strings.resent(invitation.email) }
        : { tone: 'danger', message: strings.resentUnsent(invitation.email) };
    });
  };

  // Revoking ends the link, so it asks first.
  const revoke = (invitation: InvitationView) => {
    setQuestion({
      title: strings.revokeTitle(invitation.email),
      text: strings.revokeText,
      action: strings.revokeAction,
      run: () => data.invitations.revoke(slug, invitation.id),
      done: strings.revoked(invitation.email),
    });
  };

  const memberCell = (member: MemberView, column: string) => {
    const isMe = member.id === access.memberId;
    const role = pendingRoles.get(member.id) ?? member.role;
    switch (column) {
      case 'name':
        return (
          <>
            <Avatar
              name={member.name}
              id={member.id}
              {...(member.avatarUrl === undefined ? {} : { src: member.avatarUrl })}
              isDecorative
            />
            {member.name}
            {isMe && <Badge text={strings.you} />}
          </>
        );
      case 'email':
        return member.email;
      case 'role': {
        const options = optionsFor(grantableRoles(actor, member.role));
        if (options.length === 0) return labelOf(role);
        return (
          <Select
            label={strings.roleFor(member.name)}
            isLabelHidden
            size="sm"
            items={options.map((option) => ({ id: option.id, label: option.label }))}
            value={role}
            isDisabled={pendingRoles.has(member.id)}
            onChange={(chosen) => {
              const picked = options.find((option) => option.id === chosen)?.builtIn;
              if (picked !== undefined) askRole(member, picked);
            }}
          />
        );
      }
      case 'joined':
        return <RelativeTime value={member.joinedAt} />;
      default: {
        // Only an owner hands the workspace on, to someone who isn't one yet (AC-813).
        const mayTransfer = !isMe && actor === 'owner' && member.role !== 'owner';
        const mayRemove = canRemove(actor, member.role, isMe);
        // No menu at all for a row the reader can't act on, rather than a locked one.
        if (!mayTransfer && !mayRemove) return null;
        return (
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={strings.rowActions(member.name)} />
            <Menu
              label={strings.rowActions(member.name)}
              onAction={(key) => {
                if (key === 'transfer') transfer(member);
                if (key === 'remove') remove(member);
              }}
            >
              {mayTransfer && (
                <MenuItem id="transfer" icon="crown">
                  {strings.transfer}
                </MenuItem>
              )}
              {mayTransfer && mayRemove && <MenuSeparator />}
              {mayRemove && (
                <MenuItem id="remove" icon="user-x" isDanger>
                  {strings.remove}
                </MenuItem>
              )}
            </Menu>
          </MenuTrigger>
        );
      }
    }
  };

  // Approving brings them in at once; declining ends their request, so it asks first.
  const approve = (request: JoinRequestView) => {
    setApproving(request.id);
    data.joinRequests
      .decide(slug, request.id, true)
      .then(
        async () => {
          await reload();
          toasts.toast({ tone: 'success', message: strings.approved(request.name) });
        },
        (error: unknown) => {
          toasts.toast({ tone: 'danger', message: messageOf(error) });
        },
      )
      .finally(() => {
        setApproving(undefined);
      });
  };
  const decline = (request: JoinRequestView) => {
    setQuestion({
      title: strings.declineTitle(request.name),
      text: strings.declineText,
      action: strings.declineAction,
      run: () => data.joinRequests.decide(slug, request.id, false),
      done: strings.declined(request.name),
    });
  };

  const requestCell = (request: JoinRequestView, column: string) => {
    switch (column) {
      case 'name':
        return (
          <>
            <Avatar name={request.name} id={request.id} isDecorative />
            {request.name}
          </>
        );
      case 'email':
        return request.email;
      case 'requested':
        return <RelativeTime value={request.requestedAt} />;
      default:
        return (
          <ButtonGroup label={strings.requestActions(request.name)} layout="row">
            <Button
              size="sm"
              label={strings.approveFor(request.name)}
              isPending={approving === request.id}
              isDisabled={approving !== undefined && approving !== request.id}
              onPress={() => approve(request)}
            >
              {strings.approve}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              label={strings.declineFor(request.name)}
              isDisabled={approving === request.id}
              onPress={() => decline(request)}
            >
              {strings.decline}
            </Button>
          </ButtonGroup>
        );
    }
  };

  const invitationCell = (invitation: InvitationView, column: string) => {
    switch (column) {
      case 'email':
        return invitation.email;
      case 'role':
        return labelOf(invitation.role);
      case 'invitedBy':
        return invitation.invitedBy;
      case 'expires':
        return invitation.isExpired ? <Badge text={strings.expired} /> : <RelativeTime value={invitation.expiresAt} />;
      default:
        // Only an owner manages an owner's invitation, as only an owner sends one: no menu, rather than a locked one.
        if (invitation.role === 'owner' && actor !== 'owner') return null;
        return (
          <MenuTrigger>
            <Button
              variant="ghost"
              icon="ellipsis"
              label={strings.invitationActions(invitation.email)}
              isPending={busy.has(invitation.id)}
            />
            <Menu
              label={strings.invitationActions(invitation.email)}
              onAction={(key) => {
                if (key === 'resend') resend(invitation);
                if (key === 'revoke') revoke(invitation);
              }}
            >
              <MenuItem id="resend" icon="send">
                {strings.resend}
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="revoke" icon="x" isDanger>
                {strings.revoke}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        );
    }
  };

  const searchField = (
    <Field
      label={strings.search}
      isLabelHidden
      variant="search"
      size="sm"
      placeholder={strings.searchPlaceholder}
      value={typed}
      onChange={setTyped}
    />
  );

  const membersList = (
    <>
      <Table
        label={strings.membersTab}
        columns={MEMBER_COLUMNS}
        rows={rows}
        getRowId={(member) => member.id}
        renderCell={memberCell}
        emptyState={<EmptyState icon="search" title={strings.noMatches} />}
      />
      {held.cursor !== undefined && (
        <Button variant="ghost" onPress={showMore} isPending={isLoadingMore}>
          {strings.showMore}
        </Button>
      )}
      {/* A lone member who may invite: one quiet nudge under their row, rather than a page of empty space. */}
      {canInvite && search === '' && page.total === 1 && inviteRoles.length > 0 && (
        <EmptyState layout="row" title={strings.aloneTitle}>
          {strings.aloneText}
        </EmptyState>
      )}
    </>
  );

  return (
    <SettingsPage
      title={strings.title}
      hasTabs={canInvite}
      // The page's one primary action, in the header's action place (the owner, 21 October 2026: no title block;
      // it moves to the settings header bar's action slot when that lands).
      {...(canInvite && inviteRoles.length > 0
        ? {
            actions: (
              <Button variant="primary" icon="user-plus" onPress={() => setInviting(true)}>
                {strings.invite}
              </Button>
            ),
          }
        : {})}
    >
      {canInvite ? (
        <Tabs
          label={strings.tabsLabel}
          inset="none"
          tabs={[
            { id: 'members', label: strings.membersTab, count: page.total },
            { id: 'invitations', label: strings.invitationsTab, count: invitations.length },
            // Only while any wait (AC-810), so a workspace with none never shows an empty tab.
            ...(requests.length > 0 ? [{ id: 'requests', label: strings.requestsTab, count: requests.length }] : []),
          ]}
          selectedKey={tab === 'requests' && requests.length === 0 ? 'members' : tab}
          onSelectionChange={setTab}
          {...(tab === 'members' ? { end: searchField } : {})}
        >
          <TabPanel id="members">{membersList}</TabPanel>
          <TabPanel id="invitations">
            <SettingsStack>
              {domains !== undefined && (
                <EmailDomainCard
                  data={data}
                  slug={slug}
                  domains={domains}
                  ask={setQuestion}
                  onChanged={reload}
                  onFailed={(message) => {
                    toasts.toast({ tone: 'danger', message });
                  }}
                />
              )}
              {link !== undefined && (
                <InviteLinkCard
                  data={data}
                  slug={slug}
                  link={link}
                  ask={setQuestion}
                  onChanged={reload}
                  onFailed={(message) => {
                    toasts.toast({ tone: 'danger', message });
                  }}
                />
              )}
              <Table
                label={strings.invitationsTab}
                columns={INVITATION_COLUMNS}
                rows={invitations}
                getRowId={(invitation) => invitation.id}
                renderCell={invitationCell}
                emptyState={<EmptyState icon="mail" title={strings.noInvitations} />}
              />
            </SettingsStack>
          </TabPanel>
          {requests.length > 0 && (
            <TabPanel id="requests">
              <Table
                label={strings.requestsTab}
                columns={REQUEST_COLUMNS}
                rows={requests}
                getRowId={(request) => request.id}
                renderCell={requestCell}
                emptyState={<EmptyState icon="user-plus" title={strings.noRequests} />}
              />
            </TabPanel>
          )}
        </Tabs>
      ) : (
        <>
          <Callout>{strings.readOnlyNote}</Callout>
          {searchField}
          {membersList}
        </>
      )}
      <MemberConfirm
        question={question}
        onClose={() => {
          setQuestion(undefined);
        }}
        onDone={() => {
          const said = question?.done;
          setQuestion(undefined);
          void reload();
          if (said !== undefined) toasts.toast({ tone: 'success', message: said });
        }}
      />
      <RemoveMemberDialog
        data={data}
        slug={slug}
        workspaceName={workspaceName}
        member={removing}
        onClose={() => {
          setRemoving(undefined);
        }}
        onDone={(message) => {
          setRemoving(undefined);
          void reload();
          toasts.toast({ tone: 'success', message });
        }}
      />
      {canInvite && (
        <InviteDialog
          data={data}
          slug={slug}
          isOpen={isInviting}
          roles={inviteRoles}
          defaultRole={roles.defaultRole}
          onClose={() => setInviting(false)}
          onInvited={invited}
        />
      )}
    </SettingsPage>
  );
}

/**
 * Settings › Members while it loads: the header, the tabs for those who get
 * them (or the note), the search, and skeleton rows.
 */
export function MembersPending() {
  // Tabs only for those who get tabs, so nothing moves when the page arrives.
  const canInvite = useCan('members.invite');
  const searchField = (
    <Field
      label={strings.search}
      isLabelHidden
      variant="search"
      size="sm"
      placeholder={strings.searchPlaceholder}
      isDisabled
    />
  );
  const table = (
    <Table
      label={strings.membersTab}
      columns={MEMBER_COLUMNS}
      rows={[]}
      getRowId={() => ''}
      renderCell={() => null}
      isLoading
    />
  );
  return (
    <SettingsPage
      title={strings.title}
      hasTabs={canInvite}
      // The bar's one action holds its place while the page loads.
      {...(canInvite
        ? {
            actions: (
              <Button variant="primary" icon="user-plus" isDisabled>
                {strings.invite}
              </Button>
            ),
          }
        : {})}
    >
      {canInvite ? (
        <Tabs
          label={strings.tabsLabel}
          inset="none"
          tabs={[
            { id: 'members', label: strings.membersTab },
            { id: 'invitations', label: strings.invitationsTab },
          ]}
          end={searchField}
        >
          <TabPanel id="members">{table}</TabPanel>
          <TabPanel id="invitations">{null}</TabPanel>
        </Tabs>
      ) : (
        <>
          <Callout>{strings.readOnlyNote}</Callout>
          {searchField}
          {table}
        </>
      )}
    </SettingsPage>
  );
}
