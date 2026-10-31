// Brief
// Purpose: log a call or a meeting on a record (or open one logged), on `?log=call`, `?log=meeting`, `?log=new` or `?log=<id>`.
// Main task: two clicks and a save: pick Call or Meeting, say how it went, save with ⌘↵; the time defaults to now.
// Leaves out: attendees and a calendar event (the calendar owns meetings ahead), a title, changing a call into a meeting.
import {
  outcomesFor,
  refusalSummary,
  richTextToPlain,
  type ActivityDraft,
  type DataError,
  type MemberSummary,
  type Note,
  type NoteOutcome,
  type ObjectSummary,
  type RecordRefDisplay,
  type RichTextDoc,
} from '@crm/data';
import {
  Button,
  Callout,
  ChoiceChips,
  DatePicker,
  EmptyState,
  Field,
  FieldGroup,
  Form,
  Modal,
  Popover,
  SegmentedControl,
  Select,
  Skeleton,
  Tooltip,
  useFormatSettings,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { deleteWithUndo } from '../tasks/undo-delete.ts';
import {
  durationChoices,
  instantOf,
  isTooFarAhead,
  nowWhen,
  parseMinutes,
  timeItems,
  whenOf,
  type LoggedKind,
  type When,
} from './activity.ts';
import { NoteEditor } from './editor.ts';
import { LinksField, type LinksChange } from './LinksField.tsx';
import { strings } from './strings.ts';

/** Props for the Log activity dialog. */
export interface LogActivityDialogProps {
  readonly slug: string;
  /** `call` or `meeting` (a new one of that kind), `new` (a new call), or the id of one logged. */
  readonly log: string;
  /** The page's record. */
  readonly record: RecordRefDisplay;
  readonly members: readonly MemberSummary[];
  /** The workspace's objects: the linked records picker offers those the person may change. */
  readonly objects: readonly ObjectSummary[];
  /** The person may change the record's object. */
  readonly canChange: boolean;
  /** Closes it (the address loses `?log`). */
  readonly onClose: () => void;
}

/** The kind a `log` address opens a new entry on, or undefined when it names an entry. */
export function kindOfLog(log: string): LoggedKind | undefined {
  if (log === 'meeting') return 'meeting';
  return log === 'call' || log === 'new' ? 'call' : undefined;
}

/** Whether a failed read said the entry is not there (deleted, or not the person's to see). */
function isMissing(failed: unknown): boolean {
  return typeof failed === 'object' && failed !== null && 'code' in failed && failed.code === 'NOT_FOUND';
}

/** The dialog while an entry loads, fails or is not there: one Modal from the first frame. */
function PlainModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal
      title={title}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {children}
    </Modal>
  );
}

/**
 * The Log activity dialog (parity with Attio, HubSpot and Twenty): a new call or meeting, or one logged, edited in
 * place. A new one stores nothing until Save; the save waits for the server and a refusal stays in the dialog with
 * what was typed. An entry opened again loads first, and says so when it is gone.
 */
export function LogActivityDialog(props: LogActivityDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const { slug, log, onClose } = props;
  const newKind = kindOfLog(log);
  const [opened, setOpened] = useState<Note | 'failed' | 'missing' | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (newKind !== undefined) return;
    let isLive = true;
    data.notes.read(slug, log).then(
      (found) => {
        if (isLive) setOpened(found.kind === 'note' ? 'missing' : found);
      },
      (failed: unknown) => {
        if (isLive) setOpened(isMissing(failed) ? 'missing' : 'failed');
      },
    );
    return () => {
      isLive = false;
    };
  }, [data, slug, log, newKind, attempt]);
  if (newKind !== undefined) return <ActivityForm {...props} kind={newKind} />;
  if (opened === undefined) {
    return (
      <PlainModal title={strings.logActivity} onClose={onClose}>
        <Skeleton lines={3} />
      </PlainModal>
    );
  }
  if (opened === 'failed') {
    return (
      <PlainModal title={strings.logActivity} onClose={onClose}>
        <EmptyState
          tone="error"
          title={strings.loadFailed}
          onRetry={() => {
            setOpened(undefined);
            setAttempt((count) => count + 1);
          }}
        />
      </PlainModal>
    );
  }
  if (opened === 'missing') {
    return (
      <PlainModal title={strings.logActivity} onClose={onClose}>
        <EmptyState title={strings.unavailable} actions={<Button onPress={onClose}>{strings.close}</Button>} />
      </PlainModal>
    );
  }
  return <ActivityForm {...props} kind={opened.kind === 'meeting' ? 'meeting' : 'call'} entry={opened} />;
}

/** The fields, for a new entry or one logged (`entry`). */
function ActivityForm({
  slug,
  record,
  members,
  objects,
  canChange,
  onClose,
  kind: startKind,
  entry,
}: LogActivityDialogProps & { readonly kind: LoggedKind; readonly entry?: Note }) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const { locale, timeZone } = useFormatSettings();
  const formId = useId();
  const [openedAt] = useState(() => Date.now());
  const isEdit = entry !== undefined;
  const isReadOnly = isEdit && !entry.canChange;
  // One id per opening, sent again on a retry after a lost answer.
  const [newId] = useState(() => data.notes.newId());
  const [kind, setKind] = useState<LoggedKind>(startKind);
  const [when, setWhen] = useState<When>(() =>
    entry === undefined ? nowWhen(openedAt, timeZone) : whenOf(entry.occurredAt, timeZone),
  );
  const [duration, setDuration] = useState<number | undefined>(entry?.durationMinutes);
  const [outcome, setOutcome] = useState<NoteOutcome | undefined>(entry?.outcome);
  const startText = entry === undefined ? '' : richTextToPlain(entry.content).trim();
  const [showNotes, setShowNotes] = useState(startText !== '');
  const [doc, setDoc] = useState<RichTextDoc | undefined>(undefined);
  const initialLinks = useMemo(() => entry?.links ?? [], [entry]);
  const [links, setLinks] = useState<readonly RecordRefDisplay[]>(initialLinks);
  const [showLinks, setShowLinks] = useState(initialLinks.length > 0);
  const [isSaving, setSaving] = useState(false);
  const [failure, setFailure] = useState<DataError | undefined>(undefined);
  // The custom length's popover.
  const [isAddingLength, setAddingLength] = useState(false);
  const [lengthText, setLengthText] = useState('');
  const [lengthError, setLengthError] = useState<string | undefined>(undefined);
  const customRef = useRef<HTMLButtonElement>(null);

  const times = useMemo(
    () => timeItems(locale, when.minute % 5 === 0 ? undefined : when.minute),
    [locale, when.minute],
  );
  // Judged against the clock at opening: the server checks its own again when it saves.
  const isAhead = isTooFarAhead(when, timeZone, openedAt);
  const outcomes = outcomesFor(kind);
  const mayChange = canChange && !isReadOnly;

  const addLength = () => {
    const minutes = parseMinutes(lengthText);
    if (minutes === undefined) {
      setLengthError(strings.customMinutesInvalid);
      return;
    }
    setDuration(minutes);
    setAddingLength(false);
    setLengthText('');
    setLengthError(undefined);
  };

  const save = async () => {
    if (isSaving || isAhead || !mayChange) return;
    setSaving(true);
    setFailure(undefined);
    const hasNotes = doc !== undefined && (isEdit || richTextToPlain(doc).trim() !== '');
    const draft: ActivityDraft = {
      kind,
      occurredAt: instantOf(when, timeZone),
      ...(duration === undefined ? {} : { durationMinutes: duration }),
      ...(outcome === undefined ? {} : { outcome }),
      ...(hasNotes ? { doc } : {}),
    };
    const result =
      entry === undefined
        ? await data.notes.logActivity(slug, { noteId: newId, recordId: record.recordId, draft, links })
        : await data.notes.updateActivity(slug, {
            noteId: entry.id,
            recordId: entry.recordId,
            baseVersion: entry.version,
            draft,
            add: links.filter((link) => !initialLinks.some((held) => held.recordId === link.recordId)),
            remove: initialLinks
              .filter((held) => !links.some((link) => link.recordId === held.recordId))
              .map((held) => held.recordId),
          });
    if (result.failure !== undefined) {
      setFailure(result.failure);
      setSaving(false);
      return;
    }
    if (result.linkFailure !== undefined) toasts.toast({ tone: 'danger', message: strings.linksNotSaved });
    const replaced = result.overwrote;
    if (replaced !== undefined) {
      const by = members.find((member) => member.id === replaced.by.id)?.name ?? strings.someone;
      toasts.toast({ tone: 'info', message: strings.theirsOver(by) });
    }
    onClose();
  };

  // Delete: the dialog closes at once and the toast offers Undo; a refusal takes the toast back and says why.
  const remove = () => {
    if (entry === undefined) return;
    onClose();
    deleteWithUndo({
      toasts,
      remove: () => data.notes.remove(slug, entry.recordId, entry.id),
      restore: () => data.notes.restore(slug, entry.recordId, entry.id),
      words: {
        deleted: kind === 'call' ? strings.callDeleted : strings.meetingDeleted,
        undo: strings.undo,
        notDeleted: (reason) => `${strings.notDeleted} ${reason}`,
        notRestored: (reason) => `${strings.notRestored} ${reason}`,
      },
      listLabel: strings.listLabel,
    });
  };

  const changeLinks = (change: LinksChange): Promise<undefined> => {
    const gone = new Set(change.remove);
    setLinks((held) => [...held.filter((link) => !gone.has(link.recordId)), ...change.add]);
    return Promise.resolve(undefined);
  };

  const title = isEdit ? (kind === 'call' ? strings.call : strings.meeting) : strings.logActivity;
  const primary = isEdit ? strings.save : kind === 'call' ? strings.logCallAction : strings.logMeetingAction;
  return (
    <Modal
      title={title}
      isOpen
      isDismissable={false}
      isBusy={isSaving}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      {...(isEdit && mayChange
        ? {
            headerActions: (
              <Tooltip content={strings.deleteActivity}>
                <Button variant="ghost-danger" icon="trash" label={strings.deleteActivity} onPress={remove} />
              </Tooltip>
            ),
          }
        : {})}
      actions={
        <>
          <Button slot="close" onPress={onClose}>
            {mayChange ? strings.cancel : strings.close}
          </Button>
          {mayChange && (
            <Button variant="primary" type="submit" form={formId} isPending={isSaving} isDisabled={isAhead}>
              {isSaving ? strings.logging : primary}
            </Button>
          )}
        </>
      }
    >
      <Form
        id={formId}
        label={title}
        onSubmit={() => {
          void save();
        }}
        isBusy={isSaving}
        isDisabled={isAhead || !mayChange}
        focusesFirstField
      >
        {failure !== undefined && (
          <Callout tone="danger" isAnnounced>
            {`${isEdit ? strings.saveFailed : strings.logFailed} ${refusalSummary(failure)}`}
          </Callout>
        )}
        {isReadOnly && <Callout tone="info">{strings.readOnly}</Callout>}
        <SegmentedControl
          label={strings.kindLabel}
          segments={[
            { value: 'call', label: strings.call, icon: 'phone' },
            { value: 'meeting', label: strings.meeting, icon: 'users' },
          ]}
          value={kind}
          // A logged call can't become a meeting: its outcomes are not the same words.
          isReadOnly={isEdit || !mayChange}
          onChange={(next) => {
            const changed = next === 'meeting' ? 'meeting' : 'call';
            if (changed === kind) return;
            setKind(changed);
            // The other kind's outcomes are other words: the choice goes.
            setOutcome(undefined);
          }}
        />
        <FieldGroup label={strings.when} layout="row" {...(isAhead ? { error: strings.tooFar } : {})}>
          <DatePicker
            label={strings.date}
            isLabelHidden
            isRequired
            isReadOnly={!mayChange}
            value={when.day}
            onChange={(day) => {
              if (day !== null) setWhen({ ...when, day });
            }}
          />
          <Select
            label={strings.time}
            isLabelHidden
            variant="time"
            items={times}
            value={String(when.minute)}
            isReadOnly={!mayChange}
            onChange={(id) => {
              if (id !== null) setWhen({ ...when, minute: Number(id) });
            }}
          />
        </FieldGroup>
        <ChoiceChips
          label={strings.duration}
          isSingle
          isDisabled={!mayChange}
          choices={durationChoices(duration)}
          selected={duration === undefined ? [] : [String(duration)]}
          onChange={(ids) => {
            const picked = ids.find((id) => id !== String(duration));
            setDuration(picked === undefined ? undefined : Number(picked));
          }}
          {...(mayChange
            ? {
                end: (
                  <Button
                    ref={customRef}
                    variant="dashed"
                    icon="plus"
                    onPress={() => {
                      setAddingLength(true);
                    }}
                  >
                    {strings.durationCustom}
                  </Button>
                ),
              }
            : {})}
        />
        <Popover
          label={strings.addLength}
          triggerRef={customRef}
          isOpen={isAddingLength}
          onOpenChange={(open) => {
            setAddingLength(open);
            if (!open) {
              setLengthText('');
              setLengthError(undefined);
            }
          }}
        >
          <Field
            label={strings.customMinutes}
            hint={strings.customMinutesHint}
            // The popover opens for this one field: typing starts at once.
            // eslint-disable-next-line jsx-a11y-x/no-autofocus
            autoFocus
            inputMode="numeric"
            maxLength={4}
            value={lengthText}
            onChange={(value) => {
              setLengthText(value);
              setLengthError(undefined);
            }}
            onSubmit={addLength}
            suffix={
              <Button variant="ghost" onPress={addLength} isDisabled={lengthText.trim() === ''}>
                {strings.add}
              </Button>
            }
            {...(lengthError === undefined ? {} : { error: lengthError })}
          />
        </Popover>
        <ChoiceChips
          label={strings.outcome}
          isSingle
          isDisabled={!mayChange}
          choices={outcomes.map((each) => ({ id: each, label: strings.outcomes[each] }))}
          selected={outcome === undefined ? [] : [outcome]}
          onChange={(ids) => {
            const picked = ids.find((id) => id !== outcome);
            setOutcome(outcomes.find((each) => each === picked));
          }}
        />
        {showNotes && (
          <Suspense fallback={<Skeleton lines={4} />}>
            <NoteEditor
              label={strings.notesLabel}
              defaultValue={entry === undefined ? null : entry.content}
              onChange={setDoc}
              isReadOnly={!mayChange}
              mentionName={(id) => members.find((member) => member.id === id)?.name}
              onSearchMentions={(query) => {
                const wanted = query.trim().toLowerCase();
                return Promise.resolve(
                  members
                    .filter((member) => wanted === '' || member.name.toLowerCase().includes(wanted))
                    .slice(0, 8)
                    .map((member) => ({
                      type: 'member' as const,
                      id: member.id,
                      name: member.name,
                      email: member.email,
                    })),
                );
              }}
              {...(startText === '' && !isEdit ? { autoFocus: 'text' as const } : {})}
            />
          </Suspense>
        )}
        {showLinks && (
          <LinksField
            slug={slug}
            links={links}
            objects={objects}
            startObjectId={record.objectId}
            isEditable={mayChange}
            autoOpen={links.length === 0}
            onChange={changeLinks}
          />
        )}
        {mayChange && (!showNotes || !showLinks) && (
          <FieldGroup label={strings.add} layout="row">
            {!showNotes && (
              <Button
                variant="dashed"
                icon="plus"
                onPress={() => {
                  setShowNotes(true);
                }}
              >
                {strings.addNotes}
              </Button>
            )}
            {!showLinks && (
              <Button
                variant="dashed"
                icon="plus"
                onPress={() => {
                  setShowLinks(true);
                }}
              >
                {strings.addRecords}
              </Button>
            )}
          </FieldGroup>
        )}
      </Form>
    </Modal>
  );
}
