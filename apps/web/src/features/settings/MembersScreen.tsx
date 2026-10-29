// Brief
// Purpose: Settings › Workspace › Members (spec 0031, AC-803, AC-810, AC-811): who is in the workspace, what each can
// do, and who is invited.
// Main task: find someone by name or email; owners and admins change roles, remove people and invite, answer
// requests to join, resend or cancel invitations, and set the invite link and company email (the Joining tab); an
// owner hands the workspace on; everyone reads who is in.
// Leaves out: leaving (the workspace menu's), teams and guests (later slices of spec 0031).
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
  Card,
  EmptyState,
  Field,
  InfoTip,
  Menu,
  Modal,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  RelativeTime,
  Select,
  SettingsSection,
  SettingsStack,
  Table,
  TabPanel,
  TruncatedText,
  Tabs,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import { EmailDomainRow } from './EmailDomainRow.tsx';
import { InviteLinkRows } from './InviteLinkRows.tsx';
import { MemberConfirm, type MemberQuestion } from './MemberConfirm.tsx';
import { RemoveMemberDialog } from './RemoveMemberDialog.tsx';
import { hasGuide, RoleGuide } from './RoleGuide.tsx';
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
  /** Open requests to join, for holders of `members.invite`; Asking to join shows only while any wait. */
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
        {ROLES.map((role) => `${ROLE_LABELS[role]}: ${ROLE_DESCRIPTIONS[role]}`).join(' ')}
      </InfoTip>
    ),
  },
  { id: 'joined', label: strings.columns.joined },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

/** The same columns with Two factor after Role, for owners and admins, whom the server tells (spec 0033, AC-895). */
const MEMBER_COLUMNS_WITH_FACTOR: readonly TableColumn[] = [
  ...MEMBER_COLUMNS.slice(0, 3),
  { id: 'twoFactor', label: strings.columns.twoFactor },
  ...MEMBER_COLUMNS.slice(3),
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

/** The Members page: Members and Joining tabs, the Invite dialog and the confirms. */
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
  // Owners and admins see who has two factor sign in (spec 0033, AC-895): decided by access, so it never slides in.
  const canManage = access.permissions.includes('members.manage');
  const [isInviting, setInviting] = useState(false);
  const [isGuideOpen, setGuideOpen] = useState(false);
  // The request being approved: its Approve spins and its Decline waits, so one press makes one decision.
  const [approving, setApproving] = useState<string | undefined>(undefined);
  // The tab shown: the search belongs to the Members tab alone. It opens on Joining while someone waits to join,
  // since join requests send no other notice (the Joining count alone can't tell them from invitations).
  const [tab, setTab] = useState(() => (requests.length > 0 ? 'joining' : 'members'));
  // The invitations whose Resend is on its way: their row's menu waits for the answer.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // The change the page is asking about, if any, what to say once it is done, and whether its row goes with it (focus
  // then moves to the title, since the control that asked went away).
  const [question, setQuestion] = useState<
    (MemberQuestion & { readonly done: string; readonly removesRow?: boolean }) | undefined
  >(undefined);
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
      async (changed) => {
        await reload();
        settleRole(member.id);
        const cancelled = changed.cancelledInvitations;
        const message = strings.roleChanged(member.name, labelOf(role));
        // Cancelled invitations are sent again from Invite people, which stays on the toast until dismissed.
        toasts.toast(
          cancelled === undefined
            ? { tone: 'success', message }
            : {
                tone: 'success',
                message: `${message} ${strings.roleInvitationsCancelled(cancelled)}`,
                action: { label: strings.invite, onAction: () => setInviting(true) },
              },
        );
      },
      (error: unknown) => {
        settleRole(member.id);
        toasts.toast({ tone: 'danger', message: messageOf(error) });
      },
    );
  };

  // Only someone else's role has a picker (your own reads as text), so a pick changes it at once.
  const askRole = (member: MemberView, role: Role) => {
    if (role === member.role) return;
    changeRole(member, role);
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

  // The dialog says who was invited; the Joining tab reads them in behind it.
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

  // Cancelling ends the link, so it asks first; its way out is Keep invitation, never a second Cancel.
  const revoke = (invitation: InvitationView) => {
    setQuestion({
      title: strings.revokeTitle(invitation.email),
      text: strings.revokeText,
      action: strings.revokeAction,
      dismiss: strings.keepInvitation,
      run: () => data.invitations.revoke(slug, invitation.id),
      done: strings.revoked(invitation.email),
      removesRow: true,
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
            {/* On a phone the name truncates and "You" stays whole. */}
            <TruncatedText>{member.name}</TruncatedText>
            {isMe && <Badge text={strings.you} isWhole />}
          </>
        );
      case 'email':
        return member.email;
      case 'role': {
        // Your own role is never yours to change here: it reads as text (an owner hands on through Transfer).
        const options = isMe ? [] : optionsFor(grantableRoles(actor, member.role));
        if (options.length === 0) return labelOf(role);
        return (
          <Select
            label={strings.roleFor(member.name)}
            isLabelHidden
            // The role reads as text with its chevron, like the rows that can't change it, rather than a column of boxes.
            variant="inline"
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
      case 'twoFactor':
        return member.twoFactor === true ? strings.twoFactorOn : strings.twoFactorOff;
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
          // Its row went (and Asking to join with the last one), Approve with it.
          focusTitle();
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
      removesRow: true,
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
        columns={canManage ? MEMBER_COLUMNS_WITH_FACTOR : MEMBER_COLUMNS}
        rows={rows}
        getRowId={(member) => member.id}
        renderCell={memberCell}
        isScrollable
        emptyState={<EmptyState icon="search" title={strings.noMatches} />}
      />
      {held.cursor !== undefined && (
        <Button variant="ghost" onPress={showMore} isPending={isLoadingMore}>
          {strings.showMore}
        </Button>
      )}
      {/* A lone member who may invite: the empty state under their one row (the row layout is for a list with
          more below it; nothing is below this one), with the way to fill it. */}
      {canInvite && search === '' && page.total === 1 && inviteRoles.length > 0 && (
        <EmptyState
          icon="users"
          title={strings.aloneTitle}
          actions={
            <Button icon="user-plus" onPress={() => setInviting(true)}>
              {strings.invite}
            </Button>
          }
        >
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
      // What each role can do sits before it, for everyone: choosing a role, or reading one's own, starts there.
      actions={
        <>
          {hasGuide(roles.roles) && (
            <Button icon="shield-check" onPress={() => setGuideOpen(true)}>
              {strings.roleGuide}
            </Button>
          )}
          {canInvite && inviteRoles.length > 0 && (
            <Button variant="primary" icon="user-plus" onPress={() => setInviting(true)}>
              {strings.invite}
            </Button>
          )}
        </>
      }
    >
      {canInvite ? (
        <Tabs
          label={strings.tabsLabel}
          inset="none"
          tabs={[
            { id: 'members', label: strings.membersTab, count: page.total },
            // Everyone on their way in: pending invitations and waiting requests (SW1, SW2).
            { id: 'joining', label: strings.joiningTab, count: invitations.length + requests.length },
          ]}
          selectedKey={tab}
          onSelectionChange={setTab}
          {...(tab === 'members' ? { end: searchField } : {})}
        >
          <TabPanel id="members">{membersList}</TabPanel>
          <TabPanel id="joining">
            <SettingsStack>
              {/* Only while some wait (AC-810), so a workspace with none never shows an empty list. */}
              {requests.length > 0 && (
                <SettingsSection title={strings.askingSection}>
                  <Table
                    label={strings.askingSection}
                    columns={REQUEST_COLUMNS}
                    rows={requests}
                    getRowId={(request) => request.id}
                    renderCell={requestCell}
                    // On a phone the table scrolls sideways in its own frame, as Members' does.
                    isScrollable
                  />
                </SettingsSection>
              )}
              <SettingsSection title={strings.pendingSection}>
                <Table
                  label={strings.pendingSection}
                  columns={INVITATION_COLUMNS}
                  rows={invitations}
                  getRowId={(invitation) => invitation.id}
                  renderCell={invitationCell}
                  // On a phone the table scrolls sideways in its own frame, as Members' does.
                  isScrollable
                  emptyState={<EmptyState icon="mail" title={strings.noInvitations} />}
                />
              </SettingsSection>
              {/* Set once, so last: the invite link, then the company email, a Card each, so each way reads apart. */}
              {(link !== undefined || domains !== undefined) && (
                <SettingsSection title={strings.otherWaysSection}>
                  {link !== undefined && (
                    <Card>
                      <InviteLinkRows
                        data={data}
                        slug={slug}
                        link={link}
                        ask={setQuestion}
                        onChanged={reload}
                        toasts={toasts}
                        onFailed={(message) => {
                          toasts.toast({ tone: 'danger', message });
                        }}
                      />
                    </Card>
                  )}
                  {domains !== undefined && (
                    <Card>
                      <EmailDomainRow
                        data={data}
                        slug={slug}
                        domains={domains}
                        ask={setQuestion}
                        onChanged={reload}
                        onTurnedOn={(message) => {
                          toasts.toast({ tone: 'success', message });
                        }}
                        onFailed={(message) => {
                          toasts.toast({ tone: 'danger', message });
                        }}
                      />
                    </Card>
                  )}
                </SettingsSection>
              )}
            </SettingsStack>
          </TabPanel>
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
          const removesRow = question?.removesRow === true;
          setQuestion(undefined);
          void reload().then(() => {
            if (removesRow) focusTitle();
          });
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
      <Modal
        title={strings.roleGuide}
        isOpen={isGuideOpen}
        onOpenChange={setGuideOpen}
        actions={
          <Button variant="primary" slot="close">
            {strings.done}
          </Button>
        }
      >
        <RoleGuide roles={roles.roles} initialRole={roles.roles.find((option) => option.builtIn === access.role)?.id} />
      </Modal>
      {canInvite && (
        <InviteDialog
          data={data}
          slug={slug}
          isOpen={isInviting}
          roles={inviteRoles}
          // New rows start as Member (the owner, 22 October 2026), whatever the workspace's default for joining.
          defaultRole={inviteRoles.find((option) => option.builtIn === 'member')?.id ?? roles.defaultRole}
          memberEmails={new Set(rows.map((member) => member.email.toLowerCase()))}
          // An expired invitation can be sent again, so only live ones refuse a row.
          invitedEmails={new Set(invitations.filter((each) => !each.isExpired).map((each) => each.email.toLowerCase()))}
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
  const canManage = useCan('members.manage');
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
      columns={canManage ? MEMBER_COLUMNS_WITH_FACTOR : MEMBER_COLUMNS}
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
      // The bar's actions hold their places while the page loads.
      actions={
        <>
          <Button icon="shield-check" isDisabled>
            {strings.roleGuide}
          </Button>
          {canInvite && (
            <Button variant="primary" icon="user-plus" isDisabled>
              {strings.invite}
            </Button>
          )}
        </>
      }
    >
      {canInvite ? (
        <Tabs
          label={strings.tabsLabel}
          inset="none"
          tabs={[
            { id: 'members', label: strings.membersTab },
            { id: 'joining', label: strings.joiningTab },
          ]}
          end={searchField}
        >
          <TabPanel id="members">{table}</TabPanel>
          <TabPanel id="joining">{null}</TabPanel>
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
