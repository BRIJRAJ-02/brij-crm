// Brief
// Purpose: invite people to the workspace by email, each with a role (spec 0031, AC-803).
// Main task: type an address per row (Add another, or Enter, makes the next; a pasted list splits into rows), pick
// each row's role where it differs, then Invite; the dialog then says who was invited.
// Leaves out: the invite link (the Invitations tab's card), email domains, and a seat line (until #38 sets limits).
import {
  INVITE_BATCH_MAX,
  isDataError,
  type DataLayer,
  type InvitationView,
  type InviteResult,
  type Role,
  type RoleOption,
} from '@crm/data';
import { Button, Callout, Field, Modal, Select } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { isEmail, parseEmails } from './members.ts';
import { strings } from './members-strings.ts';

/** Props for the Invite dialog. */
export interface InviteDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /**
   * The roles this person may invite as, from the workspace's roles list
   * (`roles.list`, spec 0037, AC-1439), most power first, each with its line
   * on what it can do.
   */
  readonly roles: readonly RoleOption[];
  /** The role new rows start with unless someone picks another: Member's id, when the list has Member. */
  readonly defaultRole: string;
  /**
   * Addresses of members the page has read (lowercase): a row holding one is refused before anything is sent.
   * Best effort, as the list is paged; the server still refuses anyone else who belongs, in the sent summary.
   */
  readonly memberEmails: ReadonlySet<string>;
  /** Addresses with a live invitation waiting (lowercase; expired ones can be sent again): refused the same way. */
  readonly invitedEmails: ReadonlySet<string>;
  /** The server sent some: the page reads the invitations again. */
  readonly onInvited: () => void;
}

/** One person to invite: their address as typed, the role picked, and whether they left the field. */
interface Row {
  readonly id: number;
  readonly email: string;
  readonly roleId: string;
  readonly isTouched: boolean;
}

/** What one Invite did, across the roles it was sent with. */
interface Sent {
  readonly invited: readonly InvitationView[];
  readonly refused: InviteResult['refused'];
  readonly unsent: readonly string[];
}

/** Who already belongs or is invited, so a row is refused before anything is sent. */
interface Known {
  readonly members: ReadonlySet<string>;
  readonly invited: ReadonlySet<string>;
}

/**
 * A row's problem, once it was left or Invite was pressed: not an address, one an earlier row holds, or one that
 * already belongs or is already invited.
 */
function problemOf(row: Row, rows: readonly Row[], isChecking: boolean, known: Known): string | undefined {
  const email = row.email.trim().toLowerCase();
  if (!row.isTouched && !isChecking) return undefined;
  if (email === '') return undefined;
  if (!isEmail(email)) return strings.badEmail;
  if (known.members.has(email)) return strings.alreadyMember;
  if (known.invited.has(email)) return strings.alreadyInvited;
  const first = rows.find((each) => each.email.trim().toLowerCase() === email);
  return first !== undefined && first.id !== row.id ? strings.repeatedEmail : undefined;
}

/**
 * The Invite dialog: one row per person, an email Field with that row's role
 * (a compact Select whose options carry their line below) and a remove button
 * beside it. An address that already belongs or is already invited is refused
 * in its row before anything is sent. "Add another" and Enter
 * in the last row add a row and focus it; a pasted list fills rows. Invite
 * sends every valid row, one call per role; the dialog then says who was
 * invited, who already belongs, and whose email didn't go out.
 */
export function InviteDialog({
  data,
  slug,
  isOpen,
  onClose,
  roles,
  defaultRole,
  memberEmails,
  invitedEmails,
  onInvited,
}: InviteDialogProps) {
  const startRole = roles.some((each) => each.id === defaultRole) ? defaultRole : (roles.at(-1)?.id ?? defaultRole);
  const known: Known = { members: memberEmails, invited: invitedEmails };
  const nextId = useRef(1);
  const fresh = (roleId: string, email = ''): Row => {
    nextId.current += 1;
    return { id: nextId.current, email, roleId, isTouched: email !== '' };
  };
  const [rows, setRows] = useState<readonly Row[]>(() => [{ id: 1, email: '', roleId: startRole, isTouched: false }]);
  const [isChecking, setChecking] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState<Sent | undefined>(undefined);
  const fields = useRef(new Map<number, HTMLInputElement>());
  // The row to focus once the rows just changed are drawn (a row added, removed, or filled by a paste).
  const focusNext = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusNext.current === undefined) return;
    fields.current.get(focusNext.current)?.focus();
    focusNext.current = undefined;
  });

  const valid = rows.filter(
    (row) => row.email.trim() !== '' && problemOf({ ...row, isTouched: true }, rows, true, known) === undefined,
  );
  const isFull = rows.length >= INVITE_BATCH_MAX;

  const reset = () => {
    setRows([fresh(startRole)]);
    setChecking(false);
    setFailure(undefined);
    setSent(undefined);
  };
  const close = () => {
    if (isBusy) return;
    reset();
    onClose();
  };

  const update = (id: number, change: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)));
  };

  /** Adds a row after `afterId` (the last row by default), with the role of the row before it, and focuses it. */
  const add = (afterId?: number) => {
    if (isFull) return;
    const at = afterId === undefined ? rows.length - 1 : rows.findIndex((row) => row.id === afterId);
    const row = fresh(rows[at]?.roleId ?? startRole);
    setRows([...rows.slice(0, at + 1), row, ...rows.slice(at + 1)]);
    focusNext.current = row.id;
  };

  /** Removes a row (nothing is sent yet, so it asks nothing) and focuses the one before it. */
  const remove = (id: number) => {
    const at = rows.findIndex((row) => row.id === id);
    const left = rows.filter((row) => row.id !== id);
    setRows(left);
    const focus = left[Math.max(0, at - 1)];
    if (focus !== undefined) focusNext.current = focus.id;
  };

  /** A pasted list ("a@x.com, b@y.com" or one per line) fills this row and new ones after it. */
  const type = (row: Row, value: string) => {
    const { emails } = parseEmails(value);
    if (!/[\s,;]/.test(value.trim()) || emails.length < 2) {
      update(row.id, { email: value });
      return;
    }
    const at = rows.findIndex((each) => each.id === row.id);
    const room = INVITE_BATCH_MAX - rows.length + 1;
    const filled = emails
      .slice(0, room)
      .map((email, index) => (index === 0 ? { ...row, email, isTouched: true } : fresh(row.roleId, email)));
    setRows([...rows.slice(0, at), ...filled, ...rows.slice(at + 1)]);
    // The rest never vanish without a word: they wait for the next batch.
    setFailure(emails.length > room ? strings.pasteTooMany(filled.length) : undefined);
    const last = filled.at(-1);
    if (last !== undefined) focusNext.current = last.id;
  };

  const send = () => {
    setChecking(true);
    setFailure(undefined);
    const firstProblem = rows.find((row) => problemOf(row, rows, true, known) !== undefined);
    if (firstProblem !== undefined) {
      // To the first row that needs fixing, so its message is the next thing read.
      fields.current.get(firstProblem.id)?.focus();
      return;
    }
    if (valid.length === 0) {
      setFailure(strings.noEmails);
      fields.current.get(rows[0]?.id ?? 0)?.focus();
      return;
    }
    // One call per role, in the order the roles list gives them.
    const groups = roles
      .map((role) => ({
        role: role.builtIn,
        emails: valid.filter((row) => row.roleId === role.id).map((row) => row.email.trim().toLowerCase()),
      }))
      .filter(
        (group): group is { role: Role; emails: string[] } => group.role !== undefined && group.emails.length > 0,
      );
    setBusy(true);
    // What went through so far, so a call failing part way never sends the earlier ones twice.
    let done: Sent = { invited: [], refused: [], unsent: [] };
    const handled = new Set<string>();
    groups
      .reduce<Promise<void>>(async (before, group) => {
        await before;
        const result = await data.invitations.create(slug, group.emails, group.role);
        done = {
          invited: [...done.invited, ...result.invited],
          refused: [...done.refused, ...result.refused],
          unsent: [...done.unsent, ...result.unsent],
        };
        for (const email of group.emails) handled.add(email);
      }, Promise.resolve())
      .then(
        () => {
          setBusy(false);
          setSent(done);
          if (done.invited.length > 0) onInvited();
        },
        (error: unknown) => {
          setBusy(false);
          const reason = isDataError(error) ? error.message : strings.somethingWrong;
          if (handled.size === 0) {
            setFailure(reason);
            return;
          }
          // Only the rows that didn't go stay, so Invite again retries just those.
          const left = rows.filter((row) => !handled.has(row.email.trim().toLowerCase()));
          setRows(left);
          setFailure(strings.partlySent(handled.size, reason));
          if (done.invited.length > 0) onInvited();
          focusNext.current = left[0]?.id;
        },
      );
  };

  const roleItems = roles.map((each) => ({ id: each.id, label: each.label, description: each.description }));

  if (sent !== undefined) {
    return (
      <Modal
        title={strings.inviteTitle}
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        actions={
          <>
            <Button onPress={reset}>{strings.inviteMore}</Button>
            <Button variant="primary" slot="close">
              {strings.done}
            </Button>
          </>
        }
      >
        {sent.invited.length > 0 && (
          <Callout tone="success" isAnnounced>
            {strings.sentTo(sent.invited.map((each) => each.email).join(', '))}
          </Callout>
        )}
        {sent.refused.length > 0 && (
          <Callout isAnnounced>{strings.alreadyMembers(sent.refused.map((each) => each.email).join(', '))}</Callout>
        )}
        {sent.unsent.length > 0 && <Callout tone="danger">{strings.unsent(sent.unsent.join(', '))}</Callout>}
      </Modal>
    );
  }

  return (
    <Modal
      title={strings.inviteTitle}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      // Typed addresses aren't thrown away by a stray click outside.
      isDismissable={rows.every((row) => row.email.trim() === '')}
      isBusy={isBusy}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy} onPress={close}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={send}>
            {isBusy ? strings.sending : strings.inviteCount(valid.length)}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {rows.map((row, index) => {
        const problem = problemOf(row, rows, isChecking, known);
        return (
          <Field
            key={row.id}
            ref={(element) => {
              if (element === null) fields.current.delete(row.id);
              else fields.current.set(row.id, element);
            }}
            label={strings.emailFor(index + 1)}
            isLabelHidden={index > 0}
            // Text, not email: an email input drops the line breaks of a pasted column, which then can't split. Its
            // own name and autocomplete off, so a browser never fills in the signed in person's address.
            type="text"
            inputMode="email"
            name={`invite-${String(row.id)}`}
            autoComplete="off"
            placeholder={strings.emailPlaceholder}
            value={row.email}
            isDisabled={isBusy}
            {...(problem === undefined ? {} : { error: problem })}
            onChange={(value) => {
              type(row, value);
            }}
            onBlur={() => {
              update(row.id, { isTouched: true });
            }}
            onSubmit={() => {
              const next = rows[index + 1];
              if (next !== undefined) fields.current.get(next.id)?.focus();
              // Enter on an empty last row sends, rather than adding empty rows.
              else if (row.email.trim() === '') send();
              else add(row.id);
            }}
            after={
              <>
                <Select
                  label={strings.roleFor(row.email.trim() === '' ? strings.rowName(index + 1) : row.email.trim())}
                  isLabelHidden
                  optionDescription="below"
                  items={roleItems}
                  value={row.roleId}
                  isDisabled={isBusy}
                  onChange={(next) => {
                    if (next !== null) update(row.id, { roleId: next });
                  }}
                />
                {rows.length > 1 && (
                  <Button
                    variant="ghost"
                    icon="x"
                    label={strings.removeRow(row.email.trim() === '' ? strings.rowName(index + 1) : row.email.trim())}
                    isDisabled={isBusy}
                    onPress={() => {
                      remove(row.id);
                    }}
                  />
                )}
              </>
            }
          />
        );
      })}
      {!isFull && (
        <Button
          variant="ghost"
          icon="plus"
          isFullWidth
          isDisabled={isBusy}
          onPress={() => {
            add();
          }}
        >
          {strings.addAnother}
        </Button>
      )}
    </Modal>
  );
}
