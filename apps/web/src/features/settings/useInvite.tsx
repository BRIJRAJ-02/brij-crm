// The one invite form's state and sending (owner, 22 October 2026: "use the same system to add the users across"):
// the rows InviteRows draws, each row's problem, and Send, one call per role through the data layer. Settings ›
// Members' Invite dialog (and every Invite button that opens it) and first run's Invite your team both use it.
import {
  INVITE_BATCH_MAX,
  isDataError,
  type DataLayer,
  type InvitationView,
  type InviteResult,
  type RoleOption,
} from '@crm/data';
import {
  createInviteRow,
  InfoTip,
  type InviteRow,
  type InviteRowsHandle,
  type InviteRowsProps,
  sharedStrings,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { isEmail } from './members.ts';
import { strings } from './members-strings.ts';

/** What one Send did, across the roles it was sent with. */
export interface InviteSent {
  readonly invited: readonly InvitationView[];
  readonly refused: InviteResult['refused'];
  readonly unsent: readonly string[];
}

/** Who already belongs or is invited, so a row is refused before anything is sent. */
export interface InviteKnown {
  readonly members: ReadonlySet<string>;
  readonly invited: ReadonlySet<string>;
}

/**
 * A row's problem: not an address, one that already belongs or is already
 * invited, or one an earlier row holds. Nothing for an empty row.
 */
export function inviteProblem(row: InviteRow, rows: readonly InviteRow[], known: InviteKnown): string | undefined {
  const email = row.email.trim().toLowerCase();
  if (email === '') return undefined;
  if (!isEmail(email)) return strings.badEmail;
  if (known.members.has(email)) return strings.alreadyMember;
  if (known.invited.has(email)) return strings.alreadyInvited;
  const first = rows.find((each) => each.email.trim().toLowerCase() === email);
  return first !== undefined && first.id !== row.id ? strings.repeatedEmail : undefined;
}

/**
 * The rows grouped by the role they go out as, in the roles' order: one call
 * each. Without roles every row goes out as a member.
 */
export function inviteGroups(
  rows: readonly InviteRow[],
  roles: readonly RoleOption[] | undefined,
): readonly { readonly role: string; readonly emails: readonly string[] }[] {
  const email = (row: InviteRow) => row.email.trim().toLowerCase();
  if (roles === undefined) return rows.length === 0 ? [] : [{ role: 'member', emails: rows.map(email) }];
  // A built in role by its name, a custom role (spec 0037, AC-1236) by its id, as the data layer takes them.
  return roles
    .map((option) => ({
      role: option.builtIn ?? option.id,
      emails: rows.filter((row) => row.roleId === option.id).map(email),
    }))
    .filter((group) => group.emails.length > 0);
}

/** What the invite form is given. */
export interface UseInviteOptions {
  readonly data: DataLayer;
  readonly slug: string;
  /**
   * The roles this person may invite as (most power first), each with its
   * line on what it can do. Undefined while unknown: no role column, and
   * everyone goes out as a member.
   */
  readonly roles: readonly RoleOption[] | undefined;
  /** The role new rows start with: Member's id, when the list has Member. */
  readonly defaultRole: string | undefined;
  /** Addresses of members (lowercase), refused in their row. Best effort: the server still refuses the rest. */
  readonly memberEmails?: ReadonlySet<string>;
  /** Addresses with a live invitation (lowercase), refused the same way. */
  readonly invitedEmails?: ReadonlySet<string>;
  /** The server sent some: the page reads the invitations again. */
  readonly onInvited?: () => void;
  /** What Send says with nothing typed (first run adds "or skip this step"). */
  readonly noEmails?: string;
  /**
   * Called in place of showing the sent summary when every address went out and none was refused or left
   * unmailed (31 October 2026: a clean send closes and says how many, in a toast). It gets the count and the
   * form's `reset`. Left out, the summary shows as before (first run's step has its own Continue).
   */
  readonly onClean?: (invited: number, reset: () => void) => void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The invite form: rows for InviteRows (`rowsProps`), each row's problem once
 * it was left or Send was pressed, Send (`send`), what went out (`sent`) and
 * a failure above the rows (`failure`). A call failing part way keeps only the
 * rows that didn't go, so sending again retries just those.
 */
export function useInvite({
  data,
  slug,
  roles,
  defaultRole,
  memberEmails = NONE,
  invitedEmails = NONE,
  onInvited,
  noEmails = strings.noEmails,
  onClean,
}: UseInviteOptions) {
  const startRole =
    roles === undefined
      ? undefined
      : roles.some((each) => each.id === defaultRole)
        ? defaultRole
        : (roles.at(-1)?.id ?? defaultRole);
  // Who this form invited since it opened: "Invite more" refuses them in their row too, rather than sending again
  // (which would mint a new link and end the one just mailed).
  const [justInvited, setJustInvited] = useState<ReadonlySet<string>>(new Set());
  const known: InviteKnown = {
    members: memberEmails,
    invited: justInvited.size === 0 ? invitedEmails : new Set([...invitedEmails, ...justInvited]),
  };
  // A send in flight, held outside render so a second press can never start another.
  const inFlight = useRef(false);
  const [rows, setRows] = useState<readonly InviteRow[]>(() => [createInviteRow(startRole)]);
  // Rows judged as they are left; every row once Send was pressed.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [isChecking, setChecking] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // A plain note, not a failure: a paste longer than the rows left kept the first ones.
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState<InviteSent | undefined>(undefined);
  const rowsRef = useRef<InviteRowsHandle>(null);

  // Roles arriving after the first row was made (first run reads them as it opens) give the empty rows Member.
  const shown =
    startRole === undefined
      ? rows
      : rows.map((row) => (row.roleId === undefined ? { ...row, roleId: startRole } : row));
  const errors = Object.fromEntries(
    shown
      .filter((row) => isChecking || touched.has(row.id))
      .map((row) => [row.id, inviteProblem(row, shown, known)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );
  const valid = shown.filter((row) => row.email.trim() !== '' && inviteProblem(row, shown, known) === undefined);

  const reset = () => {
    setRows([createInviteRow(startRole)]);
    setTouched(new Set());
    setChecking(false);
    setFailure(undefined);
    setNotice(undefined);
    setSent(undefined);
  };

  const send = () => {
    if (inFlight.current) return;
    setChecking(true);
    setFailure(undefined);
    setNotice(undefined);
    const firstProblem = shown.find((row) => inviteProblem(row, shown, known) !== undefined);
    if (firstProblem !== undefined) {
      // To the first row that needs fixing, so its message is the next thing read.
      rowsRef.current?.focusRow(firstProblem.id);
      return;
    }
    if (valid.length === 0) {
      setFailure(noEmails);
      const first = shown[0];
      if (first !== undefined) rowsRef.current?.focusRow(first.id);
      return;
    }
    const groups = inviteGroups(valid, roles);
    // No role this person may invite as (the server lets only owners and admins invite): say so, send nothing.
    if (groups.length === 0) {
      setFailure(strings.inviteForbidden);
      return;
    }
    setBusy(true);
    inFlight.current = true;
    // What went through so far, so a call failing part way never sends the earlier ones twice.
    let done: InviteSent = { invited: [], refused: [], unsent: [] };
    const handled = new Set<string>();
    groups
      .reduce<Promise<void>>(async (before, group) => {
        await before;
        const result = await data.invitations.create(slug, [...group.emails], group.role);
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
          inFlight.current = false;
          setJustInvited((before) => new Set([...before, ...done.invited.map((each) => each.email.toLowerCase())]));
          if (done.invited.length > 0) onInvited?.();
          if (onClean !== undefined && done.refused.length === 0 && done.unsent.length === 0) {
            onClean(done.invited.length, reset);
            return;
          }
          setSent(done);
        },
        (error: unknown) => {
          setBusy(false);
          const reason = isDataError(error) ? error.message : sharedStrings.couldntDoThat;
          inFlight.current = false;
          setJustInvited((before) => new Set([...before, ...done.invited.map((each) => each.email.toLowerCase())]));
          if (handled.size === 0) {
            setFailure(reason);
            return;
          }
          // Only the rows that didn't go stay, so Send again retries just those.
          const left = shown.filter((row) => !handled.has(row.email.trim().toLowerCase()));
          setRows(left.length > 0 ? left : [createInviteRow(startRole)]);
          // What the calls that went through said too, since their rows leave the list.
          setFailure(
            [
              strings.partlySent(handled.size, reason),
              ...(done.refused.length > 0
                ? [strings.alreadyMembers(done.refused.map((each) => each.email).join(', '))]
                : []),
              ...(done.unsent.length > 0 ? [strings.unsent(done.unsent.join(', '))] : []),
            ].join(' '),
          );
          if (done.invited.length > 0) onInvited?.();
        },
      );
  };

  const rolesInfo =
    roles === undefined ? undefined : (
      <InfoTip label={strings.aboutRoles}>
        {roles.map((each) => `${each.label}: ${each.description}`).join(' ')}
      </InfoTip>
    );

  const rowsProps: InviteRowsProps = {
    ref: rowsRef,
    rows: shown,
    onChange: (next) => {
      setRows(next);
      // A refusal or a paste's note goes once the rows change again.
      if (failure !== undefined && !isBusy) setFailure(undefined);
      if (notice !== undefined) setNotice(undefined);
    },
    ...(roles === undefined ? {} : { roles: roles.map((each) => ({ id: each.id, label: each.label })), rolesInfo }),
    errors,
    max: INVITE_BATCH_MAX,
    isDisabled: isBusy,
    onBlurRow: (id) => {
      if (shown.some((row) => row.id === id && row.email.trim() !== ''))
        setTouched((before) => new Set([...before, id]));
    },
    onSubmit: send,
    onOverflow: (kept) => {
      // The rest never vanish without a word: they wait for the next batch.
      setNotice(strings.pasteTooMany(kept));
    },
  };

  /** Whether anything is typed: a dialog keeps a stray click outside from throwing it away. */
  const isEmpty = shown.every((row) => row.email.trim() === '');

  return { rowsProps, valid, isBusy, isEmpty, failure, notice, sent, send, reset };
}
