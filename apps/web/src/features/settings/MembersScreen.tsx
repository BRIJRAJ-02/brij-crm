// Brief
// Purpose: Settings › Workspace › Members (spec 0031, AC-803, AC-810): who is in the workspace, and who is invited.
// Main task: owners and admins invite people by email and resend or revoke open invitations; everyone reads who is in.
// Leaves out: changing roles, removing and leaving (slice 3), transfer (slice 4), teams, guests, the invite link and
// email domains (later slices).
import {
  isDataError,
  ROLE_LABELS,
  type DataLayer,
  type InvitationView,
  type InviteResult,
  type MemberView,
  type MyAccess,
} from '@crm/data';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  EmptyState,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  RelativeTime,
  Table,
  TabPanel,
  Tabs,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import { MemberConfirm, type MemberQuestion } from './MemberConfirm.tsx';
import { invitableRoles } from './members.ts';
import { strings } from './members-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for the Members page: what its route loaded through the data layer. */
export interface MembersScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly members: readonly MemberView[];
  /** The open invitations; undefined for someone who can't invite (no tab at all). */
  readonly invitations: readonly InvitationView[] | undefined;
  readonly access: MyAccess;
}

const MEMBER_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.columns.name, isRowHeader: true, isInline: true },
  { id: 'email', label: strings.columns.email },
  { id: 'role', label: strings.columns.role },
  { id: 'joined', label: strings.columns.joined },
];

const INVITATION_COLUMNS: readonly TableColumn[] = [
  { id: 'email', label: strings.columns.email, isRowHeader: true },
  { id: 'role', label: strings.columns.role },
  { id: 'invitedBy', label: strings.columns.invitedBy },
  { id: 'expires', label: strings.columns.expires },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

/** The message a refusal shows, in the server's words when it gave any. */
const messageOf = (error: unknown) => (isDataError(error) ? error.message : strings.somethingWrong);

/** The Members page: Members and Invitations tabs, and the Invite dialog. */
export function MembersScreen({ data, toasts, slug, members, invitations, access }: MembersScreenProps) {
  const router = useRouter();
  const [isInviting, setInviting] = useState(false);
  // The invitations whose Resend is on its way: their row's menu waits for the answer.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // The change the page is asking about, if any (revoking an invitation), and what to say once it is done.
  const [question, setQuestion] = useState<(MemberQuestion & { readonly done: string }) | undefined>(undefined);
  // Another admin's change, or someone joining, reads the list again and the route reloads (the live `members` event).
  useEffect(() => data.members.watch(slug), [data, slug]);

  const reload = () => router.invalidate();
  const actor = access.role;
  const canInvite = invitations !== undefined && access.permissions.includes('members.invite');
  const inviteRoles = invitableRoles(actor);

  const invited = (result: InviteResult) => {
    setInviting(false);
    const parts = [
      ...(result.invited.length > 0 ? [strings.sentCount(result.invited.length)] : []),
      ...(result.refused.length > 0
        ? [strings.alreadyMembers(result.refused.map((each) => each.email).join(', '))]
        : []),
    ];
    if (parts.length > 0)
      toasts.toast({ tone: result.invited.length > 0 ? 'success' : 'info', message: parts.join(' ') });
    if (result.unsent.length > 0) toasts.toast({ tone: 'danger', message: strings.unsent(result.unsent.join(', ')) });
    void reload();
  };

  /** Runs one invitation's Resend, its row's menu waiting until the answer, then says how it went. */
  const act = (
    invitation: InvitationView,
    work: () => Promise<{ readonly tone: 'success' | 'danger'; readonly message: string }>,
  ) => {
    if (busy.has(invitation.id)) return;
    setBusy((held) => new Set(held).add(invitation.id));
    const settle = () => {
      setBusy((held) => {
        const next = new Set(held);
        next.delete(invitation.id);
        return next;
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
    switch (column) {
      case 'name':
        return (
          <>
            <Avatar name={member.name} id={member.id} isDecorative />
            {member.name}
            {member.id === access.memberId && <Badge text={strings.you} />}
          </>
        );
      case 'email':
        return member.email;
      case 'role':
        return ROLE_LABELS[member.role];
      default:
        return <RelativeTime value={member.joinedAt} />;
    }
  };

  const invitationCell = (invitation: InvitationView, column: string) => {
    switch (column) {
      case 'email':
        return invitation.email;
      case 'role':
        return ROLE_LABELS[invitation.role];
      case 'invitedBy':
        return invitation.invitedBy;
      case 'expires':
        return invitation.isExpired ? <Badge text={strings.expired} /> : <RelativeTime value={invitation.expiresAt} />;
      default: {
        // Only an owner manages an owner's invitation, as only an owner sends one: no menu, rather than a locked one.
        if (invitation.role === 'owner' && actor !== 'owner') return null;
        const isBusy = busy.has(invitation.id);
        return (
          <MenuTrigger>
            <Button
              variant="ghost"
              icon="ellipsis"
              label={strings.invitationActions(invitation.email)}
              isPending={isBusy}
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
    }
  };

  const membersTable = (
    <Table
      label={strings.membersTab}
      columns={MEMBER_COLUMNS}
      rows={members}
      getRowId={(member) => member.id}
      renderCell={memberCell}
    />
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
          tabs={[
            { id: 'members', label: strings.membersTab, count: members.length },
            { id: 'invitations', label: strings.invitationsTab, count: invitations.length },
          ]}
        >
          <TabPanel id="members">{membersTable}</TabPanel>
          <TabPanel id="invitations">
            <Table
              label={strings.invitationsTab}
              columns={INVITATION_COLUMNS}
              rows={invitations}
              getRowId={(invitation) => invitation.id}
              renderCell={invitationCell}
              emptyState={
                <EmptyState icon="mail" title={strings.noInvitations}>
                  {strings.noInvitationsText}
                </EmptyState>
              }
            />
          </TabPanel>
        </Tabs>
      ) : (
        <>
          <Callout>{strings.readOnlyNote}</Callout>
          {membersTable}
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
      {canInvite && (
        <InviteDialog
          data={data}
          slug={slug}
          isOpen={isInviting}
          roles={inviteRoles}
          onClose={() => setInviting(false)}
          onInvited={invited}
        />
      )}
    </SettingsPage>
  );
}

/** Settings › Members while it loads: the header, the tabs for those who invite (or the note), and skeleton rows. */
export function MembersPending() {
  // Tabs only for those who get tabs, so nothing moves when the page arrives.
  const canInvite = useCan('members.invite');
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
    <SettingsPage title={strings.title} hasTabs={canInvite}>
      {canInvite ? (
        <Tabs
          label={strings.tabsLabel}
          tabs={[
            { id: 'members', label: strings.membersTab },
            { id: 'invitations', label: strings.invitationsTab },
          ]}
        >
          <TabPanel id="members">{table}</TabPanel>
          <TabPanel id="invitations">{null}</TabPanel>
        </Tabs>
      ) : (
        <>
          <Callout>{strings.readOnlyNote}</Callout>
          {table}
        </>
      )}
    </SettingsPage>
  );
}
