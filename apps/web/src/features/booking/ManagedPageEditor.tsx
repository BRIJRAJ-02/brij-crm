// Brief
// Purpose: a managed booking page's editor (spec 0037, AC-1333 to AC-1336): one page an admin sets up, with a page of it for each person on it.
// Main task: its details, a Switch per part the workspace sets, who has it (added and taken off, each asked first), and deleting it.
// The two endings are opposites and say so: taking someone off deletes their page, deleting this keeps every page.
// Leaves out: the member pages themselves (each opens in its own editor, where locked parts are read only), and following a team (not built: the server refuses it).
import {
  isDataError,
  MANAGED_PARTS,
  type DataLayer,
  type ManagedMemberView,
  type ManagedPageView,
  type ManagedPart,
} from '@crm/data';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageColumn,
  SaveBar,
  Select,
  SettingsRow,
  SettingsStack,
  Switch,
  focusLater,
  type SaveBarStatus,
  type Toasts,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { LeaveGuard } from '../navigation/LeaveGuard.tsx';
import { pageHeading } from '../navigation/focus.ts';
import { managedStrings as strings } from './managed-strings.ts';

/** The most people one managed page covers (spec 0037's Numbers): past it the server refuses MANAGED_MEMBERS_LIMIT. */
const MEMBERS_MAX = 200;

/** Someone who can be put on the page: an active member who isn't a guest (the server refuses anyone else). */
export interface ManagedPerson {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly role?: string;
}

/** Props for the editor. */
export interface ManagedPageEditorProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The template as the route loaded it; the editor keeps the server's answer after each save. */
  readonly template: ManagedPageView;
  /** Who an admin may put on it (the workspace's members). */
  readonly people: readonly ManagedPerson[];
  readonly toasts: Toasts;
  /** Deleted: the caller leaves for Captures › Links, since this screen's page is gone. */
  readonly onDeleted: () => void;
}

/** What the editor holds unsaved: the details, and which parts the workspace sets. */
interface Draft {
  readonly title: string;
  readonly description: string;
  readonly locked: readonly ManagedPart[];
}

/** By name, as the server lists them, so a row added at once doesn't move when the answer lands. */
const byName = (left: ManagedMemberView, right: ManagedMemberView) => left.name.localeCompare(right.name);

/**
 * The editor. Details and the locks save together through the SaveBar, which is what moves every member page at
 * once; the people save as each change is made, since adding or taking someone off makes or deletes a whole page
 * and neither belongs in a batch with a title change.
 */
export function ManagedPageEditor({ data, slug, template: loaded, people, toasts, onDeleted }: ManagedPageEditorProps) {
  const [saved, setSaved] = useState<ManagedPageView>(loaded);
  const [draft, setDraft] = useState<Draft>(() => draftOf(loaded));
  const [isSaving, setSaving] = useState(false);
  // "Saved" is a moment after a save, not a state the bar sits in: `isDirty` decides whether the bar is there at
  // all, so a second edit always finds Save pressable (the bar's own status is derived, never latched).
  const [justSaved, setJustSaved] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [removing, setRemoving] = useState<ManagedMemberView | undefined>(undefined);
  // The last person asked about stays named while the confirm plays its exit.
  const [asked, setAsked] = useState<ManagedMemberView | undefined>(undefined);
  const [isDeleting, setDeleting] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const change = (part: Partial<Draft>) => {
    setJustSaved(false);
    setFailure(undefined);
    setDraft((before) => ({ ...before, ...part }));
  };
  const members = [...saved.members].sort(byName);
  const titleProblem = draft.title.trim() === '' ? strings.titleRequired : undefined;
  const isDirty =
    draft.title !== saved.title || draft.description !== saved.description || !sameParts(draft.locked, saved.locked);

  const save = () => {
    if (titleProblem !== undefined) return;
    setSaving(true);
    setJustSaved(false);
    setFailure(undefined);
    data.managedPages
      .update(slug, saved.id, {
        settings: { title: draft.title.trim(), description: draft.description },
        locked: [...draft.locked],
      })
      .then(
        (answer) => {
          setSaved(answer);
          setDraft(draftOf(answer));
          setSaving(false);
          setJustSaved(true);
          // How many pages the save moved is the point of a locked part: say it, rather than a bare "Saved".
          toasts.toast({
            tone: 'success',
            message:
              draft.locked.length === 0 || answer.members.length === 0
                ? strings.savedOne
                : strings.savedMany(answer.members.length),
          });
        },
        (error: unknown) => {
          setSaving(false);
          setFailure(isDataError(error) ? error.message : strings.refused);
        },
      );
  };

  /** Adds or takes off one person, the whole list sent as the server takes it. */
  const setMembers = (next: readonly string[], done: string, failed: string) => {
    setBusy(true);
    data.managedPages.setMembers(slug, saved.id, next).then(
      (answer) => {
        setBusy(false);
        setSaved(answer);
        toasts.toast({ tone: 'success', message: done });
        // A removed row took its button with it: focus goes to the picker while it still takes picks (the last
        // teammate added, or the 200th, leaves it disabled), else to the page's title rather than the body.
        focusLater(() => (pickerRef.current?.disabled === false ? pickerRef.current : pageHeading(document)));
      },
      (error: unknown) => {
        setBusy(false);
        toasts.toast({
          tone: 'danger',
          message: `${failed} ${isDataError(error) ? error.message : strings.refused}`,
        });
      },
    );
  };

  const remove = (gone: ManagedMemberView) =>
    setMembers(
      members.filter((each) => each.id !== gone.id).map((each) => each.id),
      strings.removed(gone.name),
      strings.removeFailed(gone.name),
    );

  const held = new Set(members.map((each) => each.id));
  const addable = people.filter((person) => !held.has(person.id) && person.role !== 'guest');
  const isFull = members.length >= MEMBERS_MAX;

  // The bar's state is derived, never latched: unsaved while there is something to save, "Saved" for its moment
  // after a save, and the failure in the bar rather than a second Callout above it (SaveBar's README).
  const barStatus: SaveBarStatus = !isDirty
    ? justSaved
      ? 'saved'
      : 'hidden'
    : isSaving
      ? 'saving'
      : failure === undefined
        ? 'unsaved'
        : 'error';
  return (
    <PageColumn
      footer={
        <SaveBar
          status={barStatus}
          {...(failure === undefined ? {} : { error: failure })}
          {...(titleProblem === undefined ? {} : { blockedReason: titleProblem })}
          onSave={save}
          onDiscard={() => {
            setDraft(draftOf(saved));
            setFailure(undefined);
            setJustSaved(false);
          }}
          onFocusAway={() => pageHeading(document)?.focus()}
        />
      }
    >
      <SettingsStack>
        <Card title={strings.details}>
          <Field
            label={strings.title}
            value={draft.title}
            placeholder={strings.titlePlaceholder}
            maxLength={120}
            isRequired
            onChange={(title) => change({ title })}
            {...(titleProblem === undefined ? {} : { error: titleProblem })}
          />
          <Field
            label={strings.description}
            value={draft.description}
            placeholder={strings.descriptionPlaceholder}
            isMultiline
            maxLength={2000}
            showCounter
            onChange={(description) => change({ description })}
          />
        </Card>
        <Card title={strings.locksTitle} description={strings.locksLine}>
          {/* One switch a row: the card flows its children into columns, which left eight of these ragged, with
              each line of help running under its neighbour. A stack gives one column to scan down. */}
          <SettingsStack>
            {MANAGED_PARTS.map((part) => (
              <Switch
                key={part}
                label={strings.partName[part]}
                description={strings.partLine[part]}
                isSelected={draft.locked.includes(part)}
                onChange={(isOn) =>
                  change({
                    locked: isOn
                      ? MANAGED_PARTS.filter((each) => each === part || draft.locked.includes(each))
                      : draft.locked.filter((each) => each !== part),
                  })
                }
              />
            ))}
          </SettingsStack>
        </Card>
        <Card title={strings.peopleTitle} description={strings.peopleLine}>
          <Select
            triggerRef={pickerRef}
            label={strings.addPerson}
            isLabelHidden
            savesOnPick
            isSearchable
            placeholder={isFull ? strings.full : addable.length === 0 ? strings.nobodyToAdd : strings.addPlaceholder}
            isDisabled={isBusy || isDirty || isFull || addable.length === 0}
            {...(isDirty ? { readOnlyReason: strings.saveFirst } : {})}
            items={addable.map((person) => ({
              id: person.id,
              label: person.name,
              ...(person.email === undefined ? {} : { description: person.email }),
              leading: <Avatar name={person.name} id={person.id} size="xs" isDecorative />,
            }))}
            value={null}
            onChange={(id) => {
              const person = addable.find((each) => each.id === id);
              if (person === undefined) return;
              setMembers(
                [...members.map((each) => each.id), person.id],
                strings.added(person.name),
                strings.addFailed(person.name),
              );
            }}
          />
          {members.map((member) => (
            <SettingsRow
              key={member.id}
              leading={<Avatar name={member.name} id={member.id} size="sm" isDecorative />}
              leadingAlign="center"
              title={member.name}
              {...(member.slug === undefined ? {} : { description: strings.pageAddress(member.slug) })}
            >
              {member.slug === undefined && <Badge text={strings.pageBeingMade} />}
              <Button
                variant="ghost"
                icon="x"
                label={strings.removePerson(member.name)}
                isDisabled={isBusy || isDirty}
                onPress={() => {
                  setAsked(member);
                  setRemoving(member);
                }}
              />
            </SettingsRow>
          ))}
          {members.length === 0 && <EmptyState layout="row" title={strings.noPeople} />}
        </Card>
        {/* The ending that keeps every page, at the foot and asked for in a Modal: the opposite of the x beside a
            person above, which deletes theirs. Its own card, so it is never pressed while reaching for Save. */}
        <Card title={strings.endingTitle} description={strings.endingLine}>
          <Button variant="danger" isDisabled={isBusy} onPress={() => setDeleting(true)}>
            {strings.deleteTemplate}
          </Button>
        </Card>
      </SettingsStack>
      <LeaveGuard isDirty={isDirty} searchStays />
      {/* Taking someone off DELETES their page. The opposite ending is below, and each says which one it is. */}
      <Modal
        title={strings.removeTitle(asked?.name ?? '')}
        variant="confirm"
        tone="danger"
        isOpen={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.removeKeep}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                const gone = removing;
                setRemoving(undefined);
                if (gone !== undefined) remove(gone);
              }}
            >
              {strings.removeAction(asked?.name ?? '')}
            </Button>
          </>
        }
      >
        <p>{strings.removeText(asked?.name ?? '', saved.title)}</p>
      </Modal>
      {/* Deleting this KEEPS every member page. The opposite of taking someone off, said in as many words. */}
      <Modal
        title={strings.deleteTitle(saved.title)}
        variant="confirm"
        tone="danger"
        isOpen={isDeleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(false);
        }}
        actions={
          <>
            <Button slot="close">{strings.deleteKeep}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                setDeleting(false);
                data.managedPages.remove(slug, saved.id).then(
                  () => {
                    toasts.toast({ tone: 'success', message: strings.deleted(saved.title) });
                    onDeleted();
                  },
                  (error: unknown) => {
                    toasts.toast({
                      tone: 'danger',
                      message: `${strings.deleteFailed(saved.title)} ${isDataError(error) ? error.message : strings.refused}`,
                    });
                  },
                );
              }}
            >
              {strings.deleteAction}
            </Button>
          </>
        }
      >
        <p>{strings.deleteText(saved.members.length)}</p>
      </Modal>
    </PageColumn>
  );
}

/** The template's details as the draft holds them. */
function draftOf(template: ManagedPageView): Draft {
  return { title: template.title, description: template.description, locked: [...template.locked] };
}

/** Whether two lock lists hold the same parts, whatever their order. */
function sameParts(left: readonly ManagedPart[], right: readonly ManagedPart[]): boolean {
  return left.length === right.length && left.every((part) => right.includes(part));
}
