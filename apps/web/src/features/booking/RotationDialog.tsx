// Brief
// Purpose: make or change a rotation (spec 0029, AC-728, AC-729; spec 0037): its name, how it picks, the window it counts over, where returning guests go, and its 2 to 20 members.
// Main task: add the people who share the meetings, set each one's weight, priority, daily and weekly caps and on or off, then Create or Save.
// "Everyone on the roster" (the workspace link's rotation, 30 Oct 2026) holds every active member by itself: no Add or
// Remove, only each person's own settings.
// Leaves out: shares and history (the Rotations screen), teams (#23 brings rotations that follow a team), and marking who
// can't join in the picker (that needs the server to say who can host; until then its hint says who can, and the
// server's refusal of one member offers to remove them or open their hours in a new tab).
import {
  isDataError,
  type DataLayer,
  type MemberSummary,
  type RotationMemberInput,
  type RotationView,
} from '@crm/data';
import {
  Button,
  ButtonLink,
  Callout,
  Field,
  focusLater,
  InfoTip,
  Modal,
  Radio,
  RadioGroup,
  Select,
  SettingsStack,
  Switch,
  Table,
  type SelectItem,
  type TableColumn,
  RecordChip,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { availabilityHref } from './links.ts';
import { strings } from './rotation-strings.ts';

/** Props for the dialog. */
export interface RotationDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The workspace's active members, by name. */
  readonly people: readonly MemberSummary[];
  /** The rotation being changed; none to make one. */
  readonly rotation?: RotationView;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: (rotation: RotationView) => void;
}

type Strategy = 'fair' | 'priority' | 'even';
type Returning = 'owner' | 'last_host' | 'none';
type Window = 7 | 30 | 90;

const PRIORITIES: SelectItem[] = strings.priorities.map((label, index) => ({ id: String(index), label }));
const CAPS: SelectItem[] = [
  { id: 'none', label: strings.noCap },
  ...[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((value) => ({ id: String(value), label: String(value) })),
];
const WEEKLY: SelectItem[] = [
  { id: 'none', label: strings.noCap },
  ...[2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50].map((value) => ({ id: String(value), label: String(value) })),
];
const GAPS: SelectItem[] = Array.from({ length: 10 }, (_, index) => ({
  id: String(index + 1),
  label: strings.meetings(index + 1),
}));
const RETURNING: SelectItem[] = (['owner', 'last_host', 'none'] as const).map((id) => ({
  id,
  label: strings.returningChoices[id],
}));
const WINDOWS: SelectItem[] = [7, 30, 90].map((days) => ({ id: String(days), label: strings.days(days) }));

/** A member row as the dialog edits it: the weight as typed. */
interface Draft extends Omit<RotationMemberInput, 'weight'> {
  readonly weight: string;
}

const draftOf = (member: RotationMemberInput): Draft => ({ ...member, weight: String(member.weight) });
const weightOf = (text: string): number | undefined => {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : undefined;
};

const COLUMNS: readonly TableColumn[] = [
  { id: 'member', label: strings.columns.member, isRowHeader: true },
  { id: 'weight', label: strings.columns.weight },
  { id: 'priority', label: strings.columns.priority },
  { id: 'cap', label: strings.columns.cap },
  { id: 'weekly', label: strings.columns.weekly },
  { id: 'on', label: strings.columns.on },
  { id: 'remove', label: strings.columns.remove, isLabelHidden: true, align: 'end' },
];
/** "Everyone on the roster": its members come with the workspace, so no one is removed here. */
const ROSTER_COLUMNS: readonly TableColumn[] = COLUMNS.filter((column) => column.id !== 'remove');

/** The dialog. The id is minted once per opening, so a retry makes one rotation. */
export function RotationDialog({ data, slug, people, rotation, isOpen, onClose, onSaved }: RotationDialogProps) {
  const [name, setName] = useState(rotation?.name ?? '');
  // Too few members shows as the member picker's error once Create or Save was tried.
  const [hasTried, setTried] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>(rotation?.strategy ?? 'fair');
  const [windowDays, setWindowDays] = useState<Window>(rotation?.windowDays ?? 30);
  const [evenGap, setEvenGap] = useState(rotation?.evenGap ?? 3);
  const [returning, setReturning] = useState<Returning>(rotation?.returning ?? 'owner');
  const [members, setMembers] = useState<readonly Draft[]>(() => (rotation?.members ?? []).map(draftOf));
  const [id] = useState(() => data.rotations.newId());
  const [isBusy, setBusy] = useState(false);
  const [isConfirming, setConfirming] = useState(false);
  // What went wrong, and the member a refusal was about, taken from the list that was sent, not the draft since.
  const [failure, setFailure] = useState<
    { readonly message: string; readonly memberId?: string; readonly isReach?: boolean } | undefined
  >(undefined);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const nameOf = (memberId: string) =>
    people.find((person) => person.id === memberId)?.name ??
    rotation?.members.find((member) => member.memberId === memberId)?.name ??
    memberId;
  const removed = (rotation?.members ?? []).filter(
    (member) => !members.some((each) => each.memberId === member.memberId),
  );

  const change = (memberId: string, patch: Partial<Draft>) =>
    setMembers((current) => current.map((member) => (member.memberId === memberId ? { ...member, ...patch } : member)));
  const left: SelectItem[] = people
    .filter((person) => !members.some((member) => member.memberId === person.id))
    .map((person) => ({ id: person.id, label: person.name, description: person.email }));
  // Everyone on the roster: membership follows the workspace, so the 2 to 20 of a chosen group doesn't apply.
  const isRoster = rotation?.follows === 'everyone';
  const countError = isRoster
    ? undefined
    : members.length < 2
      ? strings.needTwo
      : members.length > 20
        ? strings.tooMany
        : undefined;
  // A refusal about one member ("Maya Patel needs to set hours or connect a calendar first.") offers to remove them,
  // and, while they are an active member (so hours are what they lack), their hours in a new tab, so the group stays.
  const refused = failure?.memberId;
  // Someone the reader doesn't manage (spec 0037, AC-1340) lacks no hours: then only Remove from group is offered.
  const isRefusedActive =
    refused !== undefined && failure?.isReach !== true && people.some((person) => person.id === refused);
  // Where focus goes once a member's row or the refusal's Remove from group leaves with them: Create or Save, or the
  // next row's remove button. Left to itself it would fall to the title bar's Close, where Enter loses the draft.
  const saveRef = useRef<HTMLButtonElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const removeMember = (memberId: string, focusNext: 'row' | 'save') => {
    const index = members.findIndex((each) => each.memberId === memberId);
    const next = focusNext === 'row' ? members[index + 1]?.memberId : undefined;
    setMembers((current) => current.filter((each) => each.memberId !== memberId));
    // The refusal was about them, so it goes with them.
    if (failure?.memberId === memberId) setFailure(undefined);
    focusLater(() => (next === undefined ? undefined : removeRefs.current.get(next)) ?? saveRef.current);
  };

  const submit = () => {
    if (isBusy) return;
    setTried(true);
    const trimmed = name.trim();
    setNameError(trimmed === '' ? strings.nameRequired : undefined);
    const weights = members.map((member) => weightOf(member.weight));
    if (trimmed === '' || countError !== undefined || weights.some((weight) => weight === undefined)) return;
    if (rotation !== undefined && !isRoster && removed.length > 0 && !isConfirming) {
      setConfirming(true);
      return;
    }
    save(
      trimmed,
      members.map((member, index) => ({ ...member, weight: weights[index] ?? 100 })),
    );
  };

  /** A member's settings as the rotation was read, unchanged in the draft. */
  const sameAsHeld = (member: RotationMemberInput) => {
    const held = rotation?.members.find((each) => each.memberId === member.memberId);
    return (
      held !== undefined &&
      held.weight === member.weight &&
      held.priority === member.priority &&
      held.dailyCap === member.dailyCap &&
      held.weeklyCap === member.weeklyCap &&
      held.isOn === member.isOn
    );
  };

  const save = (trimmed: string, list: RotationMemberInput[]) => {
    setBusy(true);
    setFailure(undefined);
    const settings = { name: trimmed, strategy, windowDays, evenGap, returning };
    // Everyone on the roster takes only the people whose own settings changed: nobody joins or leaves by a save.
    const changed = isRoster ? list.filter((member) => !sameAsHeld(member)) : list;
    const sent =
      rotation === undefined
        ? data.rotations.create(slug, { id, settings, members: list })
        : data.rotations.update(slug, rotation.id, {
            settings,
            ...(isRoster && changed.length === 0 ? {} : { members: changed }),
          });
    sent.then(
      (saved) => {
        setBusy(false);
        setConfirming(false);
        onSaved(saved);
      },
      (error: unknown) => {
        setBusy(false);
        setConfirming(false);
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        const index = field?.startsWith('members.') === true ? Number(field.slice('members.'.length)) : undefined;
        const memberId = index === undefined ? undefined : changed[index]?.memberId;
        setFailure({
          message: isDataError(error) ? error.message : strings.somethingWrong,
          ...(memberId === undefined ? {} : { memberId }),
          ...(isDataError(error) && error.code === 'FORBIDDEN' ? { isReach: true } : {}),
        });
      },
    );
  };

  const renderCell = (member: Draft, column: string) => {
    const who = nameOf(member.memberId);
    const where = name.trim() === '' ? strings.newRotation : name.trim();
    switch (column) {
      case 'member':
        // A refusal about this member shows in the Callout above the table, which names them.
        return <RecordChip display={{ type: 'member', id: member.memberId, name: who }} isFlat />;
      case 'weight':
        return (
          <Field
            label={strings.weightFor(who, where)}
            isLabelHidden
            size="sm"
            inputMode="numeric"
            maxLength={3}
            value={member.weight}
            onChange={(weight) => change(member.memberId, { weight })}
            {...(weightOf(member.weight) === undefined ? { error: strings.weightInvalid, isErrorFloating: true } : {})}
          />
        );
      case 'priority':
        return (
          <Select
            label={strings.priorityFor(who, where)}
            isLabelHidden
            size="sm"
            items={PRIORITIES}
            value={String(member.priority)}
            onChange={(value) => change(member.memberId, { priority: Number(value ?? 2) })}
          />
        );
      case 'cap':
        return (
          <Select
            label={strings.capFor(who, where)}
            isLabelHidden
            size="sm"
            items={CAPS}
            value={member.dailyCap === null ? 'none' : String(member.dailyCap)}
            onChange={(value) =>
              change(member.memberId, { dailyCap: value === null || value === 'none' ? null : Number(value) })
            }
          />
        );
      case 'weekly':
        return (
          <Select
            label={strings.weeklyFor(who, where)}
            isLabelHidden
            size="sm"
            items={WEEKLY}
            value={member.weeklyCap === null ? 'none' : String(member.weeklyCap)}
            onChange={(value) =>
              change(member.memberId, { weeklyCap: value === null || value === 'none' ? null : Number(value) })
            }
          />
        );
      case 'on':
        return (
          <Switch
            label={strings.onFor(who, where)}
            isLabelHidden
            isSelected={member.isOn}
            onChange={(isOn) => change(member.memberId, { isOn })}
          />
        );
      default:
        return (
          <Button
            variant="ghost"
            icon="x"
            label={strings.remove(who)}
            ref={(element: HTMLButtonElement | null) => {
              if (element === null) removeRefs.current.delete(member.memberId);
              else removeRefs.current.set(member.memberId, element);
            }}
            onPress={() => {
              removeMember(member.memberId, 'row');
            }}
          />
        );
    }
  };

  return (
    <>
      <Modal
        title={rotation === undefined ? strings.newRotation : strings.editRotation}
        variant="window"
        isOpen={isOpen && !isConfirming}
        isDismissable={false}
        isBusy={isBusy}
        onOpenChange={(open) => {
          if (!open && !isBusy) onClose();
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isBusy}>
              {strings.cancel}
            </Button>
            <Button variant="primary" ref={saveRef} isPending={isBusy} onPress={submit}>
              {rotation === undefined
                ? isBusy
                  ? strings.creating
                  : strings.create
                : isBusy
                  ? strings.saving
                  : strings.save}
            </Button>
          </>
        }
      >
        <SettingsStack>
          {failure !== undefined && (
            <Callout
              tone="danger"
              {...(refused === undefined
                ? {}
                : {
                    actions: (
                      <>
                        {isRoster ? (
                          // Nobody leaves Everyone on the roster by a save: the fix is to switch them off.
                          <Button
                            onPress={() => {
                              change(refused, { isOn: false });
                              setFailure(undefined);
                              focusLater(() => saveRef.current);
                            }}
                          >
                            {strings.switchOffRefused(nameOf(refused))}
                          </Button>
                        ) : (
                          <Button
                            label={strings.removeRefused(nameOf(refused))}
                            onPress={() => {
                              removeMember(refused, 'save');
                            }}
                          >
                            {strings.removeFromGroup}
                          </Button>
                        )}
                        {isRefusedActive && (
                          <ButtonLink
                            href={availabilityHref(slug, refused)}
                            isExternal
                            icon="external-link"
                            label={strings.setHoursFor(nameOf(refused))}
                          >
                            {strings.setHours}
                          </ButtonLink>
                        )}
                      </>
                    ),
                  })}
            >
              {failure.message}
            </Callout>
          )}
          <Field
            label={strings.name}
            // A new group starts with its name, so the field takes focus as the dialog opens (Q102).
            autoFocus={rotation === undefined}
            placeholder={strings.namePlaceholder}
            // Everyone on the roster is named by the workspace link that books it.
            isReadOnly={isRoster}
            value={name}
            onChange={(next) => {
              setName(next);
              // Typing is the fix: the error goes as soon as there is a name again (SS-R3).
              setNameError(undefined);
            }}
            maxLength={80}
            isRequired
            {...(nameError === undefined ? {} : { error: nameError })}
          />
          <RadioGroup
            label={strings.strategy}
            variant="cards"
            value={strategy}
            onChange={(value) => {
              if (value === 'fair' || value === 'priority' || value === 'even') setStrategy(value);
            }}
          >
            <Radio value="fair" icon="scale" description={strings.fairLine}>
              {strings.fairCard}
            </Radio>
            <Radio value="priority" icon="star" description={strings.priorityLine}>
              {strings.priorityCard}
            </Radio>
            <Radio value="even" icon="users" description={strings.evenLine}>
              {strings.evenCard}
            </Radio>
          </RadioGroup>
          {strategy === 'even' && (
            <Select
              label={strings.evenGap}
              items={GAPS}
              value={String(evenGap)}
              onChange={(value) => setEvenGap(Number(value ?? 3))}
            />
          )}
          <Select
            label={strings.window}
            info={<InfoTip label={strings.window}>{strings.windowInfo}</InfoTip>}
            items={WINDOWS}
            value={String(windowDays)}
            onChange={(value) => setWindowDays(value === '7' ? 7 : value === '90' ? 90 : 30)}
          />
          <Select
            label={strings.returning}
            hint={strings.returningHint}
            items={RETURNING}
            value={returning}
            onChange={(value) => {
              if (value === 'owner' || value === 'last_host' || value === 'none') setReturning(value);
            }}
          />
          {isRoster ? (
            <Callout tone="info">
              {strings.rosterNote(members.filter((member) => member.isOn).length, members.length)}
            </Callout>
          ) : (
            <Select
              label={strings.addMember}
              placeholder={left.length === 0 ? strings.noMembersLeft : strings.addMemberPlaceholder}
              items={left}
              isSearchable
              isDisabled={left.length === 0 || members.length >= 20}
              value={null}
              // Who can join, in plain words (SS-R1): a link here would open the reader's own hours, not a teammate's.
              hint={strings.membersHint(members.length)}
              {...(hasTried && countError !== undefined ? { error: countError } : {})}
              onChange={(memberId) => {
                if (memberId === null) return;
                setMembers((current) => [
                  ...current,
                  { memberId, weight: '100', priority: 2, dailyCap: null, weeklyCap: null, isOn: true },
                ]);
              }}
            />
          )}
          {members.length > 0 && (
            <Table
              label={strings.members(name.trim() === '' ? strings.newRotation : name.trim())}
              isScrollable
              columns={isRoster ? ROSTER_COLUMNS : COLUMNS}
              rows={members}
              getRowId={(member) => member.memberId}
              renderCell={renderCell}
            />
          )}
        </SettingsStack>
      </Modal>
      <Modal
        title={strings.removeTitle(
          removed.map((member) => member.name),
          rotation?.name ?? '',
        )}
        variant="confirm"
        tone="danger"
        isOpen={isOpen && isConfirming}
        isBusy={isBusy}
        onOpenChange={(open) => {
          if (!open && !isBusy) setConfirming(false);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isBusy}>
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isBusy} onPress={submit}>
              {isBusy ? strings.saving : strings.removeAction}
            </Button>
          </>
        }
      >
        {strings.removeText}
      </Modal>
    </>
  );
}
