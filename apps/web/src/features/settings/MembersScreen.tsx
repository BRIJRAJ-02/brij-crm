// Brief
// Purpose: Settings › Workspace › Members (spec 0031, AC-803, AC-810, AC-811): who is in the workspace, what each can
// do, and who is invited.
// Main task: find someone by name or email; owners and admins change roles, remove people and invite, answer
// requests to join, resend or cancel invitations, and set the invite link and company email (the Joining tab); an
// owner hands the workspace on; a step down (to Guest above all) asks first; everyone reads who is in, a guest
// without anyone's email.
// Leaves out: leaving (the workspace menu's), teams and roles (their own pages), and a role for the invite link.
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
  type RolesOverview,
  type TeamView,
} from '@crm/data';
import {
  Avatar,
  Badge,
  BulkActionBar,
  Button,
  ButtonGroup,
  Callout,
  Card,
  EmptyState,
  Field,
  InfoTip,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  RelativeTime,
  Select,
  SettingsSection,
  SettingsStack,
  sharedStrings,
  Table,
  type TableColumn,
  TabPanel,
  Tabs,
  type Toasts,
  TruncatedText,
} from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import { EmailDomainRow } from './EmailDomainRow.tsx';
import { InviteLinkRows } from './InviteLinkRows.tsx';
import { MemberConfirm, type MemberQuestion } from './MemberConfirm.tsx';
import { RemoveMemberDialog } from './RemoveMemberDialog.tsx';
import { hasGuide, RoleGuide } from './RoleGuide.tsx';
import { SCHEDULING_ACCESS_COLUMN, SchedulingAccessCell } from './SchedulingAccessCell.tsx';
import {
  askReconnect,
  askReconnectItem,
  CalendarHealthChip,
  offersAsk,
  useCalendarHealth,
  useSchedulingStore,
} from '../booking/CalendarHealth.tsx';
import { calendarHealthStrings } from '../booking/calendar-health-strings.ts';
import { canRemove, grantableRoles, invitableRoles } from './members.ts';
import { CapabilitiesDialog } from './CapabilitiesDialog.tsx';
import { roleTakesAway } from './roles.ts';
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
  /** The roles every role picker offers (`roles.list`, spec 0037, AC-1439), most power first, then custom roles. */
  readonly roles: RolesList;
  /** Every role with what it holds (`roles.overview`): whether a change takes access away, "What can Priya do". */
  readonly overview: RolesOverview;
  /** The workspace's teams, for team delegations in the Scheduling access column (undefined: not read). */
  readonly teams?: readonly TeamView[] | undefined;
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

/** A guest's columns (spec 0031, AC-829): no Email, since the server tells a guest nobody's address. */
const GUEST_COLUMNS: readonly TableColumn[] = MEMBER_COLUMNS.filter((column) => column.id !== 'email');

/** The same columns with Two factor after Role, for owners and admins, whom the server tells (spec 0033, AC-895). */
const MEMBER_COLUMNS_WITH_FACTOR: readonly TableColumn[] = [
  ...MEMBER_COLUMNS.slice(0, 3),
  { id: 'twoFactor', label: strings.columns.twoFactor },
  SCHEDULING_ACCESS_COLUMN,
  // Each person's calendar health (spec 0037, AC-1308): a status, never an account or a calendar.
  { id: 'calendar', label: calendarHealthStrings.column },
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
const messageOf = (error: unknown) => (isDataError(error) ? error.message : sharedStrings.couldntDoThat);

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
  overview,
  teams,
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
    (MemberQuestion & { readonly done?: string; readonly removesRow?: boolean }) | undefined
  >(undefined);
  // The member the remove dialog asks about, if any (it reads what their removal does, AC-816).
  const [removing, setRemoving] = useState<MemberView | undefined>(undefined);
  // A role shown at once while its change is sent, put back if the server refuses (by member id).
  const [pendingRoles, setPendingRoles] = useState<ReadonlyMap<string, string>>(new Map());
  // The person "What can Priya do" is open on (spec 0037, AC-1243).
  const [explaining, setExplaining] = useState<MemberView | undefined>(undefined);
  // The people ticked for Change role (spec 0037, AC-1242), and whether that change is on its way.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isBulkBusy, setBulkBusy] = useState(false);
  // The pick whose guest count is out: a later pick's answer wins, an earlier one is dropped.
  const counting = useRef<symbol | undefined>(undefined);
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
  const isGuest = actor === 'guest';
  const canInvite = invitations !== undefined && access.permissions.includes('members.invite');
  // The roles list's options this person may invite as, or give a member: the owner rules, as the server keeps them.
  // Custom roles (spec 0037, AC-1242) sit on the Member role, so they come with it, after the built in ones.
  const optionsFor = (allowed: readonly Role[]) =>
    roles.roles.filter((option) =>
      option.builtIn === undefined ? allowed.includes('member') : allowed.includes(option.builtIn),
    );
  const inviteRoles = optionsFor(invitableRoles(actor));
  /** A role's name as the roles list says it: a built in role's name, or a custom role's id. */
  const labelOf = (role: string) => {
    const builtIn = ROLES.find((each) => each === role);
    return (
      roles.roles.find((option) => option.id === role)?.label ?? (builtIn === undefined ? role : ROLE_LABELS[builtIn])
    );
  };
  /** The role a member holds, as the role Selects name it: their custom role's id, else their built in role. */
  const roleIdOf = (member: MemberView) => member.customRoleId ?? member.role;
  /** A role option for a Select: custom ones under "Custom". */
  const itemOf = (option: RolesList['roles'][number]) => ({
    id: option.id,
    label: option.label,
    ...(option.builtIn === undefined ? { group: strings.custom } : {}),
  });
  const held = more.from === page ? more : { from: page, members: [], cursor: page.nextCursor };
  const rows = [...page.members, ...held.members];
  // The ticks on rows shown now: a search that hides someone untick them (spec 0037, AC-1242).
  const ticked: ReadonlySet<string> = new Set(
    rows.filter((member) => selected.has(member.id)).map((member) => member.id),
  );
  // Calendar health for the rows shown, read together, for holders of `members.manage` (AC-1308).
  const healthStore = useSchedulingStore(data, canManage);
  const health = useCalendarHealth(healthStore, slug, canManage ? rows.map((member) => member.id) : []);

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

  /** One toast for a role change, with the invitations it cancelled and Invite people to send them again. */
  const sayRoleChanged = (member: MemberView, role: string, cancelled: number | undefined) => {
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
  };

  // Someone else's role changes at once and goes back, with the server's reason, if it refuses.
  const changeRole = (member: MemberView, role: string) => {
    setPendingRoles((pending) => new Map(pending).set(member.id, role));
    data.members.setRole(slug, member.id, role).then(
      async (changed) => {
        await reload();
        settleRole(member.id);
        sayRoleChanged(member, role, changed.cancelledInvitations);
      },
      (error: unknown) => {
        settleRole(member.id);
        toasts.toast({ tone: 'danger', message: messageOf(error) });
      },
    );
  };

  // Only someone else's role has a picker (your own reads as text). A pick that gives more changes it at once; one that
  // takes access away asks first (the owner, 21 October 2026), saying what becoming a guest stops (spec 0031, slice 9).
  const askRole = (member: MemberView, role: string) => {
    const current = roleIdOf(member);
    if (role === current) return;
    if (!roleTakesAway(overview.roles, current, role)) {
      changeRole(member, role);
      return;
    }
    const builtInStep = member.customRoleId === undefined && (member.role === 'owner' || member.role === 'admin');
    const ask = (chips: readonly string[]) => {
      setQuestion({
        title: strings.roleDownTitle(member.name, labelOf(role)),
        text:
          role === 'guest'
            ? strings.roleGuestText(member.name)
            : builtInStep
              ? strings.roleDownText(member.name, member.role)
              : strings.roleCustomDown(member.name),
        chips,
        action: strings.roleDownAction(labelOf(role)),
        // The same one toast as a change made at once says it, so the confirm adds none of its own.
        run: async () => {
          const changed = await data.members.setRole(slug, member.id, role);
          sayRoleChanged(member, role, changed.cancelledInvitations);
        },
      });
    };
    if (role !== 'guest') {
      ask([]);
      return;
    }
    // What becoming a guest stops, counted first, the row's Select waiting meanwhile; a failed count still asks, and
    // says it couldn't count. Only the latest pick's answer opens the confirm.
    const pick = Symbol(member.id);
    counting.current = pick;
    setPendingRoles((pending) => new Map(pending).set(member.id, current));
    const settle = () => {
      settleRole(member.id);
      return counting.current === pick;
    };
    data.members.guestPreview(slug, member.id).then(
      (preview) => {
        if (!settle()) return;
        ask([
          ...(preview.pausedPages > 0 ? [strings.guestPages(preview.pausedPages)] : []),
          ...(preview.rotations > 0 ? [strings.guestRotations(preview.rotations)] : []),
          ...(preview.upcomingBookings > 0 ? [strings.guestBookings(preview.upcomingBookings)] : []),
          ...(preview.delegations > 0 ? [strings.guestDelegations(preview.delegations)] : []),
          ...(preview.hidesLinkPage ? [strings.guestLinkPage] : []),
        ]);
      },
      () => {
        if (settle()) ask([strings.guestUncounted]);
      },
    );
  };

  /** Whether the reader may give this person another role in a Change role for several (the owner rules). */
  const mayRechange = (member: MemberView) =>
    member.id !== access.memberId && grantableRoles(actor, member.role).length > 0;

  // Change role for everyone ticked (spec 0037, AC-1242): at once when it gives more, asked first when it takes any
  // access away from anyone; one call, so a refusal changes nobody.
  const askBulkRole = (role: string) => {
    if (isBulkBusy) return;
    const picked = rows.filter((member) => ticked.has(member.id) && mayRechange(member));
    if (picked.length === 0) return;
    const run = async () => {
      setBulkBusy(true);
      try {
        const done = await data.members.setRoles(
          slug,
          picked.map((member) => member.id),
          role,
        );
        await reload();
        setSelected(new Set());
        toasts.toast({ tone: 'success', message: strings.bulkRoleChanged(done.changed, labelOf(role)) });
      } finally {
        setBulkBusy(false);
      }
    };
    if (!picked.some((member) => roleTakesAway(overview.roles, roleIdOf(member), role))) {
      run().catch((error: unknown) => {
        toasts.toast({ tone: 'danger', message: messageOf(error) });
      });
      return;
    }
    setQuestion({
      title: strings.bulkRoleTitle(picked.length, labelOf(role)),
      text: strings.bulkRoleText,
      action: strings.roleDownAction(labelOf(role)),
      run,
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
    const role = pendingRoles.get(member.id) ?? roleIdOf(member);
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
            savesOnPick
            label={strings.roleFor(member.name)}
            isLabelHidden
            // The role reads as text with its chevron, like the rows that can't change it, rather than a column of boxes.
            variant="inline"
            items={options.map(itemOf)}
            value={role}
            isDisabled={pendingRoles.has(member.id)}
            onChange={(chosen) => {
              const picked = options.find((option) => option.id === chosen);
              if (picked !== undefined) askRole(member, picked.id);
            }}
          />
        );
      }
      case 'twoFactor':
        return member.twoFactor === true ? strings.twoFactorOn : strings.twoFactorOff;
      case 'scheduling':
        return (
          <SchedulingAccessCell
            data={data}
            toasts={toasts}
            slug={slug}
            me={access.memberId}
            member={member}
            teams={teams}
          />
        );
      case 'calendar':
        // A guest connects no calendar (spec 0031, slice 9).
        return member.role === 'guest' ? null : <CalendarHealthChip state={health.get(member.id)} name={member.name} />;
      case 'joined':
        return <RelativeTime value={member.joinedAt} />;
      default: {
        // Only an owner hands the workspace on, to someone who isn't one yet (AC-813).
        const mayTransfer = !isMe && actor === 'owner' && member.role !== 'owner';
        const mayRemove = canRemove(actor, member.role, isMe);
        // Ask to reconnect (spec 0037, AC-1309): a colleague whose calendar needs them.
        const calendar = isMe ? undefined : health.get(member.id);
        const mayAsk = offersAsk(calendar);
        // "What can Priya do" (spec 0037, AC-1243): about oneself, or anyone for holders of `members.manage`.
        const mayExplain = isMe || canManage;
        // No menu at all for a row the reader can't act on, rather than a locked one.
        if (!mayTransfer && !mayRemove && !mayAsk && !mayExplain) return null;
        const first = member.name.trim().split(/\s+/)[0] ?? member.name;
        return (
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={strings.rowActions(member.name)} />
            <Menu
              label={strings.rowActions(member.name)}
              onAction={(key) => {
                if (key === 'explain') setExplaining(member);
                if (key === 'transfer') transfer(member);
                if (key === 'remove') remove(member);
                if (key === 'ask-reconnect') askReconnect(healthStore, slug, member.id, member.name);
              }}
            >
              {mayExplain && (
                <MenuItem id="explain" icon="id-card">
                  {strings.capabilities.menu(first)}
                </MenuItem>
              )}
              {mayExplain && (mayAsk || mayTransfer || mayRemove) && <MenuSeparator />}
              {askReconnectItem(calendar)}
              {mayAsk && (mayTransfer || mayRemove) && <MenuSeparator />}
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
      placeholder={isGuest ? strings.searchNamePlaceholder : strings.searchPlaceholder}
      value={typed}
      onChange={setTyped}
    />
  );

  const membersList = (
    <>
      <Table
        label={strings.membersTab}
        columns={canManage ? MEMBER_COLUMNS_WITH_FACTOR : isGuest ? GUEST_COLUMNS : MEMBER_COLUMNS}
        rows={rows}
        getRowId={(member) => member.id}
        renderCell={memberCell}
        isScrollable
        emptyState={<EmptyState icon="search" title={strings.noMatches} />}
        {...(canManage
          ? {
              selected: ticked,
              // Only the people the reader may give a role to tick (never themself, an owner only for an owner), so the
              // bar's count is the change's.
              onSelectedChange: (ids: ReadonlySet<string>) => {
                setSelected(
                  new Set(rows.filter((member) => ids.has(member.id) && mayRechange(member)).map((m) => m.id)),
                );
              },
              getSelectLabel: (member: MemberView) => strings.selectMember(member.name),
            }
          : {})}
      />
      {canManage && ticked.size > 0 && (
        <BulkActionBar
          count={ticked.size}
          total={rows.length}
          onClear={() => {
            setSelected(new Set());
          }}
        >
          <Select
            savesOnPick
            label={strings.bulkRoleLabel(ticked.size)}
            isLabelHidden
            placeholder={strings.bulkRole}
            items={optionsFor(grantableRoles(actor, 'member')).map(itemOf)}
            // Always the placeholder: a pick is an action, and a cancelled confirm leaves nothing chosen.
            value={null}
            isDisabled={isBulkBusy}
            onChange={(chosen) => {
              if (chosen !== null) askBulkRole(chosen);
            }}
          />
        </BulkActionBar>
      )}
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
          {/* A guest changes nothing here, and the read only table says so already. */}
          {!isGuest && <Callout>{sharedStrings.ownersAndAdminsOnly}</Callout>}
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
        meId={access.memberId}
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
      <CapabilitiesDialog
        data={data}
        slug={slug}
        member={explaining}
        roles={overview.roles}
        members={rows}
        readsEveryone={canManage}
        onClose={() => {
          setExplaining(undefined);
        }}
      />
      {canInvite && (
        <InviteDialog
          data={data}
          slug={slug}
          isOpen={isInviting}
          roles={inviteRoles}
          // New rows start with the role new people get (spec 0037, AC-1237): Member, unless a custom role is marked.
          defaultRole={
            inviteRoles.find((option) => option.id === roles.defaultRole)?.id ??
            inviteRoles.find((option) => option.builtIn === 'member')?.id ??
            roles.defaultRole
          }
          memberEmails={
            new Set(rows.flatMap((member) => (member.email === undefined ? [] : [member.email.toLowerCase()])))
          }
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
          <Callout>{sharedStrings.ownersAndAdminsOnly}</Callout>
          {searchField}
          {table}
        </>
      )}
    </SettingsPage>
  );
}
