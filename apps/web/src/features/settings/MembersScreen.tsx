// Brief
// Purpose: Settings › People › Members (spec 0031, AC-803, AC-810, AC-811; owner ask T12, "looks confusing"): who is
// in the workspace and who is on their way in, in one table.
// Main task: find someone by name or email; read each person's role and status at a glance; owners and admins
// change roles, answer requests to join, resend or revoke invitations, remove people (each ending asks first), and
// open a row for the rest (two factor, calendar, scheduling access); invite from the bar's one button.
// Leaves out: leaving (the workspace menu's), teams and roles (their own tabs and pages), and a role for the invite
// link.
import {
  isDataError,
  ROLES,
  ROLE_LABELS,
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
  type TeamView,
  type RolesOverview,
} from '@crm/data';
import {
  Avatar,
  Badge,
  BulkActionBar,
  Button,
  ButtonGroup,
  Card,
  DescriptionList,
  EmptyState,
  Field,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Panel,
  PersonLine,
  PreviewFooter,
  RelativeTime,
  Select,
  SettingsRow,
  SettingsSection,
  SettingsStack,
  sharedStrings,
  Skeleton,
  Switch,
  Table,
  type DescriptionItem,
  type TableColumn,
  type Toasts,
  usePhoneWidth,
} from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import { EmailDomainRow } from './EmailDomainRow.tsx';
import { InviteLinkRows } from './InviteLinkRows.tsx';
import { MemberConfirm, type MemberQuestion } from './MemberConfirm.tsx';
import { RemoveMemberDialog } from './RemoveMemberDialog.tsx';
import { SchedulingAccessCell } from './SchedulingAccessCell.tsx';
import {
  askReconnect,
  askReconnectItem,
  CalendarHealthChip,
  offersAsk,
  useCalendarHealth,
  useSchedulingStore,
} from '../booking/CalendarHealth.tsx';
import { canRemove, grantableRoles, invitableRoles } from './members.ts';
import { CapabilitiesDialog } from './CapabilitiesDialog.tsx';
import { reachOf, roleTakesAway } from './roles.ts';
import { strings as roleStrings } from './roles-strings.ts';
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
  /** The open invitations; undefined for someone who can't invite (no rows for anyone on their way in). */
  readonly invitations: readonly InvitationView[] | undefined;
  /** The invite link, for holders of `members.invite` (with the invitations). */
  readonly link?: InviteLinkView | undefined;
  /** Open requests to join, for holders of `members.invite`; their rows show only while any wait. */
  readonly requests?: readonly JoinRequestView[] | undefined;
  /** The email domains, for holders of `workspace.manage`. */
  readonly domains?: WorkspaceDomainsView | undefined;
  readonly access: MyAccess;
  /** The roles every role picker offers (`roles.list`, spec 0037, AC-1439), most power first, then custom roles. */
  readonly roles: RolesList;
  /** The workspace's teams, for team delegations in Scheduling access (undefined: not read). */
  readonly teams?: readonly TeamView[] | undefined;
  /** Every role with what it holds (`roles.overview`): whether a change takes access away, "What can Priya do". */
  readonly overview: RolesOverview;
}

/**
 * One row of the table (owner ask T12: one list, not a hidden tab): someone asking to join, someone invited, or a
 * member. Requests and invitations carry a prefix in their id, so no row can share a member's id.
 */
type PersonRow =
  | { readonly kind: 'request'; readonly id: string; readonly request: JoinRequestView }
  | { readonly kind: 'invitation'; readonly id: string; readonly invitation: InvitationView }
  | { readonly kind: 'member'; readonly id: string; readonly member: MemberView };

/**
 * The table's columns: the person (picture, name, and their email under it), their role, their status (for those who
 * may invite, the only readers who see anyone but members), then the row's actions. Two factor, calendar and
 * scheduling access live in the row's details.
 */
const NAME_COLUMN: TableColumn = { id: 'name', label: strings.columns.name, isRowHeader: true, phone: 'title' };
const ROLE_COLUMN: TableColumn = { id: 'role', label: strings.columns.role };
const STATUS_COLUMN: TableColumn = { id: 'status', label: strings.columns.status };
const ACTIONS_COLUMN: TableColumn = {
  id: 'actions',
  label: strings.columns.actions,
  isLabelHidden: true,
  align: 'end',
  size: 'fit',
};
const COLUMNS: readonly TableColumn[] = [NAME_COLUMN, ROLE_COLUMN, ACTIONS_COLUMN];
const COLUMNS_WITH_STATUS: readonly TableColumn[] = [NAME_COLUMN, ROLE_COLUMN, STATUS_COLUMN, ACTIONS_COLUMN];

/** How long the search waits after the last key before it asks again. */
const SEARCH_WAIT_MS = 250;

/** The message a refusal shows, in the server's words when it gave any. */
const messageOf = (error: unknown) => (isDataError(error) ? error.message : sharedStrings.couldntDoThat);

/** Whether a request or an invitation answers the search the members were read for (the server searched those). */
const answers = (search: string, ...texts: readonly string[]) => {
  const query = search.trim().toLocaleLowerCase();
  return query === '' || texts.some((text) => text.toLocaleLowerCase().includes(query));
};

/** The Members page: one table of members and everyone on their way in, a row's details beside it, and the confirms. */
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
  teams,
  overview,
}: MembersScreenProps) {
  const router = useRouter();
  // Owners and admins see who has two factor sign in (spec 0033, AC-895): decided by access, so it never slides in.
  const canManage = access.permissions.includes('members.manage');
  const [isInviting, setInviting] = useState(false);
  // The request being approved: its Approve spins and its Decline waits, so one press makes one decision.
  const [approving, setApproving] = useState<string | undefined>(undefined);
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
  // The row whose details are open beside the table, by row id (it closes when the row goes).
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  // On a phone a row's details fill the screen, with Back to Members as their way out.
  const isPhone = usePhoneWidth();
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
  /**
   * A role option for a Select: its one line of what it allows under its name (owner ask T12: role help lives in the
   * picker, not a button in the bar), custom ones under "Custom".
   */
  const itemOf = (option: RolesList['roles'][number]) => ({
    id: option.id,
    label: option.label,
    ...(option.description === '' ? {} : { description: option.description }),
    ...(option.builtIn === undefined ? { group: strings.custom } : {}),
  });
  const held = more.from === page ? more : { from: page, members: [], cursor: page.nextCursor };
  const members = [...page.members, ...held.members];
  // Everyone on their way in, first, since they wait on someone here (the requests, then the invitations), narrowed
  // by the search as the members were; then the members. Only those who may invite see anyone on their way in.
  const people: readonly PersonRow[] = [
    ...(canInvite
      ? [
          ...requests
            .filter((request) => answers(search, request.name, request.email))
            .map((request): PersonRow => ({ kind: 'request', id: `request:${request.id}`, request })),
          ...invitations
            .filter((invitation) => answers(search, invitation.email))
            .map((invitation): PersonRow => ({ kind: 'invitation', id: `invitation:${invitation.id}`, invitation })),
        ]
      : []),
    ...members.map((member): PersonRow => ({ kind: 'member', id: member.id, member })),
  ];
  // The ticks on rows shown now: a search that hides someone unticks them (spec 0037, AC-1242).
  const ticked: ReadonlySet<string> = new Set(
    members.filter((member) => selected.has(member.id)).map((member) => member.id),
  );
  // Calendar health for the rows shown, read together, for holders of `members.manage` (AC-1308).
  const healthStore = useSchedulingStore(data, canManage);
  const health = useCalendarHealth(healthStore, slug, canManage ? members.map((member) => member.id) : []);
  // The row whose details show, fresh from this render's rows; the last one kept (by its id, since every render makes
  // new rows) while the panel plays its exit after its row went or it closed.
  const opened = people.find((row) => row.id === openId);
  const [lastOpened, setLastOpened] = useState<PersonRow | undefined>(opened);
  if (opened !== undefined && opened.id !== lastOpened?.id) setLastOpened(opened);
  // A row that went (a removal, a search that hides it) is forgotten, so its details never reopen by themselves.
  if (openId !== undefined && opened === undefined) setOpenId(undefined);
  const shown = opened ?? lastOpened;
  const isSelecting = ticked.size > 0;
  // The bar stays mounted while it sinks out, until its onLeft.
  const [isBarShown, setBarShown] = useState(isSelecting);
  if (isSelecting && !isBarShown) setBarShown(true);

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
    const picked = members.filter((member) => ticked.has(member.id) && mayRechange(member));
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
    // Always asked (5 November 2026): while anyone is ticked a click on a row ticks it too (React Aria's toggle), so
    // a click meant to look could otherwise hand someone more access unseen.
    const takesAway = picked.some((member) => roleTakesAway(overview.roles, roleIdOf(member), role));
    setQuestion({
      title: strings.bulkRoleTitle(picked.length, labelOf(role)),
      text: takesAway ? strings.bulkRoleText : strings.bulkRoleGiveText,
      action: strings.roleDownAction(labelOf(role)),
      ...(takesAway ? {} : { tone: 'default' as const }),
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

  // Removing asks first in its own dialog, which reads what the removal changes (AC-814, AC-816).
  const remove = (member: MemberView) => {
    setRemoving(member);
  };

  // The dialog says who was invited; the table reads them in behind it.
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

  // Revoking ends the link, so it asks first; its way out is Keep invitation.
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

  // Approving brings them in at once; declining ends their request, so it asks first.
  const approve = (request: JoinRequestView) => {
    setApproving(request.id);
    data.joinRequests
      .decide(slug, request.id, true)
      .then(
        async () => {
          await reload();
          toasts.toast({ tone: 'success', message: strings.approved(request.name) });
          // Its Approve went with its row (they are a member now, further down): focus to the page's title.
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

  /** What the reader may do to a member, by the owner rules (the server's too). */
  const powersOver = (member: MemberView) => {
    const isMe = member.id === access.memberId;
    const calendar = isMe ? undefined : health.get(member.id);
    return {
      isMe,
      // Only an owner hands the workspace on, to someone who isn't one yet (AC-813).
      mayTransfer: !isMe && actor === 'owner' && member.role !== 'owner',
      mayRemove: canRemove(actor, member.role, isMe),
      // Ask to reconnect (spec 0037, AC-1309): a colleague whose calendar needs them.
      calendar,
      mayAsk: offersAsk(calendar),
      // "What can Priya do" (spec 0037, AC-1243): about oneself, or anyone for holders of `members.manage`.
      mayExplain: isMe || canManage,
    };
  };

  /** A member's role: their picker where the reader may change it, else its name as text (your own always). */
  const roleOf = (member: MemberView, label?: string): ReactNode => {
    const role = pendingRoles.get(member.id) ?? roleIdOf(member);
    const options = member.id === access.memberId ? [] : optionsFor(grantableRoles(actor, member.role));
    if (options.length === 0) return labelOf(role);
    return (
      <Select
        savesOnPick
        label={label ?? strings.roleFor(member.name)}
        isLabelHidden
        // The role reads as text with its chevron, like the rows that can't change it, rather than a column of boxes.
        variant="inline"
        items={options.map(itemOf)}
        // Each role's one line wraps under its name, so the list stays a menu wide (as New role's Start from).
        optionDescription="below"
        value={role}
        isDisabled={pendingRoles.has(member.id)}
        onChange={(chosen) => {
          const picked = options.find((option) => option.id === chosen);
          if (picked !== undefined) askRole(member, picked.id);
        }}
      />
    );
  };

  /** A member's reach over others' scheduling, in a few words or its popover (spec 0037, AC-1267). */
  const schedulingOf = (member: MemberView): ReactNode => {
    // A custom role that sees or manages everyone reaches everyone but owners and admins (spec 0037): said as text,
    // as Owner's and Admin's Everyone is.
    const customRole =
      member.customRoleId === undefined ? undefined : overview.roles.find((each) => each.id === member.customRoleId);
    if (customRole !== undefined && reachOf(customRole.permissions).see === 'everyone') return roleStrings.allButAdmins;
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
  };

  /** A member's row menu: What can Priya do, Ask to reconnect, Transfer ownership, Remove from workspace. */
  const memberMenu = (member: MemberView, inDetails = false) => {
    const { mayTransfer, mayRemove, calendar, mayAsk, mayExplain } = powersOver(member);
    // No menu at all for a row the reader can't act on, rather than a locked one.
    if (!mayTransfer && !mayRemove && !mayAsk && !mayExplain) return null;
    const first = member.name.trim().split(/\s+/)[0] ?? member.name;
    return (
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={strings.rowActions(member.name)} />
        <Menu
          label={strings.rowActions(member.name)}
          onAction={(key) => {
            if (key === 'details') setOpenId(member.id);
            if (key === 'explain') setExplaining(member);
            if (key === 'transfer') transfer(member);
            if (key === 'remove') remove(member);
            if (key === 'ask-reconnect') askReconnect(healthStore, slug, member.id, member.name);
          }}
        >
          {/* What a click on the row opens, named where people look for more. */}
          {!inDetails && (
            <MenuItem id="details" icon="info">
              {strings.details.menu}
            </MenuItem>
          )}
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
  };

  /** Whether the reader may resend or revoke an invitation: only an owner manages an owner's, as only an owner sends one. */
  const managesInvitation = (invitation: InvitationView) => invitation.role !== 'owner' || actor === 'owner';

  /** An invitation's row menu: Details, Resend, then Revoke invitation (asked first). */
  const invitationMenu = (invitation: InvitationView) => {
    // No menu, rather than a locked one.
    if (!managesInvitation(invitation)) return null;
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
            if (key === 'details') setOpenId(`invitation:${invitation.id}`);
            if (key === 'resend') resend(invitation);
            if (key === 'revoke') revoke(invitation);
          }}
        >
          <MenuItem id="details" icon="info">
            {strings.details.menu}
          </MenuItem>
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
  };

  /** A request's answer: Approve, and Decline (asked first). */
  const requestButtons = (request: JoinRequestView) => (
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

  /** A row's status: Active as plain words, so the exceptions stand out, a blue dot Invited, orange when it waits on someone here. */
  const statusOf = (row: PersonRow) => {
    if (row.kind === 'member') return strings.status.active;
    if (row.kind === 'request') return <Badge text={strings.status.asking} dot="orange" isWhole />;
    return row.invitation.isExpired ? (
      <Badge text={strings.status.expired} dot="orange" isWhole />
    ) : (
      <Badge text={strings.status.invited} dot="blue" isWhole />
    );
  };

  const cell = (row: PersonRow, column: string): ReactNode => {
    switch (column) {
      case 'name':
        if (row.kind === 'member') {
          const { member } = row;
          return (
            <PersonLine
              id={member.id}
              name={member.name}
              // Their email under the name; a guest is told nobody's address (spec 0031, AC-829). The reader's own row
              // says "You" first, beside the name rather than across a wide column at the line's end.
              meta={[
                ...(member.id === access.memberId ? [strings.you] : []),
                ...(member.email === undefined ? [] : [member.email]),
                // No login of their own (spec 0070): a page only person, or a connected app's.
                ...(member.managed === undefined
                  ? []
                  : [
                      member.managed.kind === 'page_only'
                        ? strings.pageOnly
                        : member.managed.app === undefined
                          ? strings.viaAnApp
                          : strings.viaApp(member.managed.app),
                    ]),
              ]}
              {...(member.avatarUrl === undefined ? {} : { src: member.avatarUrl })}
            />
          );
        }
        if (row.kind === 'request') {
          return <PersonLine id={row.request.id} name={row.request.name} meta={[row.request.email]} />;
        }
        return (
          <PersonLine
            id={row.invitation.id}
            name={row.invitation.email}
            meta={[strings.invitedByLine(row.invitation.invitedBy)]}
          />
        );
      case 'role':
        if (row.kind === 'member') return roleOf(row.member);
        if (row.kind === 'invitation') return row.invitation.roleLabel ?? labelOf(row.invitation.role);
        // Someone asking joins with the role new people get (spec 0037, AC-1237), as the server's approval gives it.
        return labelOf(roles.defaultRole);
      case 'status':
        return statusOf(row);
      default:
        if (row.kind === 'member') return memberMenu(row.member);
        if (row.kind === 'invitation') return invitationMenu(row.invitation);
        return requestButtons(row.request);
    }
  };

  /** What a row's details hold beside the table: the facts the table leaves out, and its actions at the foot. */
  const detailsOf = (row: PersonRow) => {
    if (row.kind === 'member') {
      const { member } = row;
      const { mayRemove, mayExplain } = powersOver(member);
      const first = member.name.trim().split(/\s+/)[0] ?? member.name;
      const items: DescriptionItem[] = [
        ...(member.email === undefined
          ? []
          : [
              {
                term: strings.details.email,
                description: member.email,
                copy: { value: member.email, label: strings.details.copyEmail },
              },
            ]),
        { term: strings.details.role, description: roleOf(member, strings.details.role) },
        { term: strings.details.status, description: statusOf(row) },
        { term: strings.details.joined, description: <RelativeTime value={member.joinedAt} /> },
        // What only owners and admins are told, or may change (spec 0033, AC-895; spec 0037, AC-1267, AC-1308).
        ...(canManage
          ? [
              {
                term: strings.details.twoFactor,
                description: member.twoFactor === true ? strings.twoFactorOn : strings.twoFactorOff,
              },
              // A guest connects no calendar and holds no scheduling (spec 0031, slice 9).
              ...(member.role === 'guest'
                ? []
                : [
                    {
                      term: strings.details.calendar,
                      description: <CalendarHealthChip state={health.get(member.id)} name={member.name} />,
                    },
                    { term: strings.details.scheduling, description: schedulingOf(member) },
                  ]),
            ]
          : []),
      ];
      return {
        title: member.name,
        leading: (
          <Avatar
            name={member.name}
            id={member.id}
            {...(member.avatarUrl === undefined ? {} : { src: member.avatarUrl })}
            isDecorative
          />
        ),
        items,
        // Everything the row's menu holds (Transfer ownership, Ask to reconnect among them), in the head.
        actions: memberMenu(member, true),
        footer: mayExplain ? (
          <Button icon="id-card" onPress={() => setExplaining(member)}>
            {strings.capabilities.menu(first)}
          </Button>
        ) : null,
        footerStart: mayRemove ? (
          <Button variant="danger" icon="user-x" onPress={() => remove(member)}>
            {strings.remove}
          </Button>
        ) : null,
      };
    }
    if (row.kind === 'invitation') {
      const { invitation } = row;
      const manages = managesInvitation(invitation);
      return {
        title: invitation.email,
        leading: <Avatar name={invitation.email} id={invitation.id} isDecorative />,
        items: [
          { term: strings.details.role, description: invitation.roleLabel ?? labelOf(invitation.role) },
          { term: strings.details.status, description: statusOf(row) },
          { term: strings.details.invitedBy, description: invitation.invitedBy },
          {
            term: invitation.isExpired ? strings.details.expired : strings.details.expires,
            description: <RelativeTime value={invitation.expiresAt} />,
          },
        ] satisfies DescriptionItem[],
        footer: manages ? (
          <Button icon="send" isPending={busy.has(invitation.id)} onPress={() => resend(invitation)}>
            {strings.resend}
          </Button>
        ) : null,
        footerStart: manages ? (
          <Button variant="danger" icon="x" onPress={() => revoke(invitation)}>
            {strings.revoke}
          </Button>
        ) : null,
      };
    }
    const { request } = row;
    return {
      title: request.name,
      leading: <Avatar name={request.name} id={request.id} isDecorative />,
      items: [
        {
          term: strings.details.email,
          description: request.email,
          copy: { value: request.email, label: strings.details.copyEmail },
        },
        { term: strings.details.role, description: labelOf(roles.defaultRole) },
        { term: strings.details.status, description: statusOf(row) },
        { term: strings.details.requested, description: <RelativeTime value={request.requestedAt} /> },
      ] satisfies DescriptionItem[],
      footer: (
        <Button
          variant="primary"
          isPending={approving === request.id}
          isDisabled={approving !== undefined && approving !== request.id}
          onPress={() => approve(request)}
        >
          {strings.approve}
        </Button>
      ),
      footerStart: (
        <Button variant="danger" isDisabled={approving === request.id} onPress={() => decline(request)}>
          {strings.decline}
        </Button>
      ),
    };
  };
  const details = shown === undefined ? undefined : detailsOf(shown);

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

  return (
    <SettingsPage
      title={strings.title}
      // Who changes this page: a "View only" tag by the title (the owner's less-text rule), never a box over the
      // list. A guest changes nothing here, and the read only table says so already.
      {...(!canInvite && !isGuest ? { viewOnly: sharedStrings.ownersAndAdminsOnly } : {})}
      tabBody="table"
      // The entry's tab strip (Members · Teams): Members' own tab carries the count, the search at the strip's end.
      tabBar={{ count: page.total, end: searchField }}
      // The page's one primary action, in the bar (the owner, 21 October 2026: no title block). Role help lives in the
      // role picker and on Roles and access, never a second button here (owner ask T12).
      actions={
        <>
          {canInvite && inviteRoles.length > 0 && (
            <Button variant="primary" icon="user-plus" onPress={() => setInviting(true)}>
              {strings.invite}
            </Button>
          )}
        </>
      }
    >
      <Table
        label={canInvite ? strings.peopleTable : strings.membersTab}
        // Status only where the table can hold anyone but members: the readers who may invite.
        columns={canInvite ? COLUMNS_WITH_STATUS : COLUMNS}
        rows={people}
        getRowId={(row) => row.id}
        renderCell={cell}
        onRowAction={setOpenId}
        // On a phone each row reads as two lines: the person, then their role and status, nothing scrolling sideways.
        phoneLayout="rows"
        emptyState={<EmptyState icon="search" title={strings.noMatches} />}
        // How many show of how many, and the next page, while more wait.
        {...(held.cursor === undefined
          ? {}
          : {
              footer: (
                <>
                  {strings.shownOf(members.length, page.total)}
                  <Button variant="ghost" size="sm" onPress={showMore} isPending={isLoadingMore}>
                    {strings.showMore}
                  </Button>
                </>
              ),
            })}
        // Checkboxes only while someone here can take a new role, so Select all never ticks nothing.
        {...(canManage && members.some(mayRechange)
          ? {
              selected: ticked,
              // Only the people the reader may give a role to tick (never themself, an owner only for an owner, nobody
              // on their way in), so the bar's count is the change's.
              isRowSelectable: (row: PersonRow) => row.kind === 'member' && mayRechange(row.member),
              onSelectedChange: (ids: ReadonlySet<string>) => {
                setSelected(new Set(members.filter((member) => ids.has(member.id)).map((member) => member.id)));
              },
              getSelectLabel: (row: PersonRow) =>
                row.kind === 'member'
                  ? row.member.name
                  : row.kind === 'request'
                    ? row.request.name
                    : row.invitation.email,
            }
          : {})}
      />
      {/* Set once, so after the list (and never among a search's matches): the invite link, then the company email, a
          Card each, so each way reads apart; a breath under the table's last row. */}
      {canInvite && search === '' && (link !== undefined || domains !== undefined) && (
        <SettingsStack>
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
        </SettingsStack>
      )}
      {/* Change role for those ticked, at the view's foot however long the list, as Trash's and a form's Submissions'. */}
      {canManage && isBarShown && (
        <PreviewFooter>
          <BulkActionBar
            placement="footer"
            isOpen={isSelecting}
            onLeft={() => {
              setBarShown(false);
            }}
            count={ticked.size}
            total={members.length}
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
              optionDescription="below"
              // Always the placeholder: a pick is an action, and a cancelled confirm leaves nothing chosen.
              value={null}
              isDisabled={isBulkBusy}
              onChange={(chosen) => {
                if (chosen !== null) askBulkRole(chosen);
              }}
            />
          </BulkActionBar>
        </PreviewFooter>
      )}
      {/* A row's details beside the list, the page narrowing for them: closed by Esc, its close button, or its row
          going (a removal, a revoke, an approval). */}
      <Panel
        title={details?.title ?? ''}
        // On a phone the panel is the whole screen: its close is Back to Members at the head's start, where a phone
        // looks for the way out, as a form's submission does; elsewhere the person's picture leads the title.
        {...(isPhone
          ? { closeAs: 'back' as const, backLabel: strings.backToMembers }
          : details === undefined
            ? {}
            : { leading: details.leading })}
        isOpen={opened !== undefined}
        onClose={() => {
          setOpenId(undefined);
        }}
        isStacked
        pushesPage
        // Actions only while it is open: nothing to press on a row already gone as the panel leaves.
        {...(opened === undefined || details?.actions === undefined || details.actions === null
          ? {}
          : { actions: details.actions })}
        {...(opened === undefined || details?.footer === undefined || details.footer === null
          ? {}
          : { footer: details.footer })}
        {...(opened === undefined || details?.footerStart === undefined || details.footerStart === null
          ? {}
          : { footerStart: details.footerStart })}
      >
        {details !== undefined && <DescriptionList items={details.items} />}
      </Panel>
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
          // Their row, its menu and any details went with them: focus to the page's title.
          void reload().then(focusTitle);
          toasts.toast({ tone: 'success', message });
        }}
      />
      <CapabilitiesDialog
        data={data}
        slug={slug}
        member={explaining}
        roles={overview.roles}
        members={members}
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
            new Set(members.flatMap((member) => (member.email === undefined ? [] : [member.email.toLowerCase()])))
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
 * Settings › Members while it loads: the bar, the tab strip with the search, and the table's skeleton rows under its
 * columns, so nothing moves when the page arrives.
 */
export function MembersPending({ isSearching = false }: { readonly isSearching?: boolean }) {
  const canInvite = useCan('members.invite');
  const canManageWorkspace = useCan('workspace.manage');
  return (
    <SettingsPage
      title={strings.title}
      {...(canInvite ? {} : { viewOnly: sharedStrings.ownersAndAdminsOnly })}
      tabBody="table"
      tabBar={{
        end: (
          <Field
            label={strings.search}
            isLabelHidden
            variant="search"
            size="sm"
            placeholder={strings.searchPlaceholder}
            isDisabled
          />
        ),
      }}
      // The bar's actions hold their places while the page loads.
      actions={
        <>
          {canInvite && (
            <Button variant="primary" icon="user-plus" isDisabled>
              {strings.invite}
            </Button>
          )}
        </>
      }
    >
      <Table
        label={strings.membersTab}
        columns={canInvite ? COLUMNS_WITH_STATUS : COLUMNS}
        rows={[]}
        getRowId={() => ''}
        renderCell={() => null}
        phoneLayout="rows"
        isLoading
      />
      {/* Other ways to join, as the page will draw them under its list (and, as it does, not among a search's matches). */}
      {canInvite && !isSearching && (
        <SettingsStack>
          <SettingsSection title={strings.otherWaysSection}>
            <Card isBusy>
              <SettingsRow title={strings.linkTitle} description={<Skeleton width="long" />}>
                <Switch label={strings.linkTitle} isLabelHidden isDisabled />
              </SettingsRow>
            </Card>
            {canManageWorkspace && (
              <Card isBusy>
                <SettingsRow title={strings.domainTitle} description={<Skeleton width="long" />}>
                  <Switch label={strings.domainTitle} isLabelHidden isDisabled />
                </SettingsRow>
              </Card>
            )}
          </SettingsSection>
        </SettingsStack>
      )}
    </SettingsPage>
  );
}
