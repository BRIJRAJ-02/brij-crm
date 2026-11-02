// Brief
// Purpose: everything about one task, beside the page it opened from, on `?task=<id>` (a new one is still a dialog).
// Main task: read it at a glance, tick it off, and change its title, notes, due day, assignee and records in place.
// Leaves out: comments and an activity feed on a task (neither exists: comments are record scoped), rich text in the
// description, reminders beyond the due day's inbox notice, subtasks, a task's own full page.
import {
  refusalSummary,
  TASK_DESCRIPTION_MAX,
  TASK_RECORDS_MAX,
  TASK_TITLE_MAX,
  searchMembers,
  toActorDisplays,
  type ActorDisplay,
  type DataError,
  type MemberSummary,
  type ObjectSummary,
  type RecordRefDisplay,
  type TaskChange,
  type TaskSubscription,
  type TaskView,
} from '@crm/data';
import { useTask } from '@crm/data/react';
import {
  arraySource,
  AttributeEditor,
  Button,
  Callout,
  DescriptionList,
  EmptyState,
  Field,
  Form,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  RecordPanel,
  RelativeTime,
  Tooltip,
  type FieldAttribute,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { memberDisplay } from './entries.ts';
import { deleteWithUndo } from './undo-delete.ts';
import { taskCreatedToast } from './toasts.ts';
import { strings } from './strings.ts';
import { editorSearch, useRecordSearch } from '../records/links.ts';

/** Props for the task panel. */
export interface TaskPanelProps {
  readonly slug: string;
  /** The task's id, or `new`. */
  readonly task: string;
  /** The record the dialog opened over: a new task starts linked to it. */
  readonly pageRecord?: RecordRefDisplay;
  /** The object the record picker starts on (the page's), else the first. */
  readonly startObjectId?: string;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  readonly meId: string | undefined;
  /** Closes it (the address loses `?task`). */
  readonly onClose: () => void;
  /** The list the dialog opened from, by its name: it takes focus back after a delete. */
  readonly listLabel?: string;
  /** Opens a task's panel: the "Task created" toast's Open. */
  readonly onOpenTask?: (taskId: string) => void;
  /**
   * Steps to the task above or below in the list the panel was opened from, as a record's panel steps through its
   * view (↑ and ↓ too). Leave one out at either end, and both out where the panel wasn't opened from a list.
   */
  readonly onPrevious?: () => void;
  readonly onNext?: () => void;
}

/** The member a member editor committed, or null when it was cleared. */
function memberIdOf(value: unknown): string | null {
  const picked: unknown = Array.isArray(value) ? (value as readonly unknown[])[0] : value;
  if (typeof picked !== 'object' || picked === null || !('id' in picked)) return null;
  return typeof picked.id === 'string' ? picked.id : null;
}

/** A task subscription that only says it is loading, until the store's arrives. */
const LOADING_TASK: TaskSubscription = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING_STATE,
  retain: () => () => undefined,
  retry: () => undefined,
};
const LOADING_STATE = { status: 'loading' } as const;

/** A task subscription that only says it failed, with Try again (`retry`), when the task's code didn't load. */
function failedTask(retry: () => void): TaskSubscription {
  const state = { status: 'error' } as const;
  return { subscribe: () => () => undefined, getSnapshot: () => state, retain: () => () => undefined, retry };
}

/** Which field a refusal shows under. */
type FieldName = 'title' | 'description' | 'isDone' | 'dueOn' | 'assignee' | 'records';

/** The panel's one view: there are no comments or activity on a task, so a lone tab strip would say nothing. */
const SUBJECT_ICON = 'square-check' as const;

/** The dialog's attributes, through the field set's own editors (one field design, house rule 3). */
function attributeOf(
  id: string,
  name: string,
  type: 'date' | 'actor_reference' | 'record_reference',
  readOnlyReason: string | undefined,
): FieldAttribute {
  return {
    id,
    name,
    type,
    allowMultiple: type === 'record_reference',
    ...(type === 'record_reference' ? { cardinality: 'many' as const } : {}),
    isRequired: false,
    isUnique: false,
    isReadOnly: readOnlyReason !== undefined,
    ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
  };
}

/** The fields a task has, whether it is new (held here until Create) or saved (each committed as it changes). */
interface TaskFieldsProps {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  /** A saved task's fields commit as they change; a new one's are held until Create. */
  readonly isSaved: boolean;
  readonly dueOn: string | undefined;
  readonly assigneeMemberId: string | undefined;
  readonly records: readonly RecordRefDisplay[];
  readonly objects: readonly ObjectSummary[];
  readonly startObjectId: string | undefined;
  readonly members: readonly MemberSummary[];
  readonly meId: string | undefined;
  readonly readOnlyReason?: string;
  readonly errors: Partial<Record<FieldName, string>>;
  readonly onChange: (change: TaskChange) => void;
  /** The title as typed, before it is committed (a new task holds it). */
  readonly onTitleInput?: (title: string) => void;
  /** The description as typed, before it is committed (a new task holds it). */
  readonly onDescriptionInput?: (description: string) => void;
}

/** The title, description, Done (a saved task only), due date, assignee and records, each through its one editor. */
function TaskFields({
  slug,
  title,
  description,
  isSaved,
  dueOn,
  assigneeMemberId,
  records,
  objects,
  startObjectId,
  members,
  meId,
  readOnlyReason,
  errors,
  onChange,
  onTitleInput,
  onDescriptionInput,
}: TaskFieldsProps) {
  const [draft, setDraft] = useState(title);
  // The description, as the title: a change from elsewhere shows only when the person isn't typing over it.
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  const [shownDescription, setShownDescription] = useState(description);
  if (description !== shownDescription) {
    setShownDescription(description);
    if (descriptionDraft === shownDescription) setDescriptionDraft(description);
  }
  const commitDescription = () => {
    const trimmed = descriptionDraft.trim();
    if (trimmed !== description) onChange({ description: trimmed });
  };
  // A saved task's description typed and then closed with Esc (no blur on the way out) is still saved.
  const commitOnClose = useRef<() => void>(() => undefined);
  useEffect(() => {
    commitOnClose.current = isSaved ? commitDescription : () => undefined;
  });
  useEffect(() => {
    const latest = commitOnClose;
    return () => {
      latest.current();
    };
  }, []);
  // A change from elsewhere (live, or a refusal putting it back) shows only when the person isn't typing over it.
  const [shownTitle, setShownTitle] = useState(title);
  if (title !== shownTitle) {
    setShownTitle(title);
    if (draft === shownTitle) setDraft(title);
  }
  // Only objects the person may change can take a link (AC-447): the picker starts on the page's object when it is
  // one of them, else the first; with none, Records is read only and says why.
  const writable = objects.filter((object) => object.access === 'write');
  const [objectId, setObjectId] = useState(
    writable.find((object) => object.id === startObjectId)?.id ?? writable[0]?.id ?? '',
  );
  const recordsReason = readOnlyReason ?? (writable.length === 0 ? strings.linkForbidden : undefined);
  const search = useRecordSearch(slug, objectId);
  const [recordsError, setRecordsError] = useState<string | undefined>(undefined);
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  // A saved task's title emptied says why it wasn't saved, and keeps what was typed (a new one waits for Create).
  const commitTitle = () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (isSaved) setTitleError(strings.titleRequired);
      return;
    }
    setTitleError(undefined);
    if (trimmed === title) return;
    onChange({ title: trimmed });
  };
  const shownTitleError = titleError ?? errors.title;
  const memberDisplays = toActorDisplays(members);
  const me = meId === undefined ? undefined : memberDisplays.find((member) => member.id === meId);
  const assignee: ActorDisplay | undefined =
    assigneeMemberId === undefined ? undefined : memberDisplay(members, assigneeMemberId);
  const byId = new Map(objects.map((object) => [object.id, object]));
  return (
    <>
      <Field
        label={strings.title}
        value={draft}
        onChange={(next) => {
          setDraft(next);
          if (next.trim() !== '') setTitleError(undefined);
          onTitleInput?.(next);
        }}
        onBlur={commitTitle}
        onSubmit={commitTitle}
        isWrapping
        maxLength={TASK_TITLE_MAX}
        showCounter
        isRequired
        {...(readOnlyReason === undefined ? {} : { isReadOnly: true, readOnlyReason })}
        {...(shownTitleError === undefined ? {} : { error: shownTitleError })}
      />
      <Field
        label={strings.description}
        value={descriptionDraft}
        onChange={(next) => {
          setDescriptionDraft(next);
          onDescriptionInput?.(next);
        }}
        onBlur={commitDescription}
        isMultiline
        maxLength={TASK_DESCRIPTION_MAX}
        showCounter
        {...(readOnlyReason === undefined ? {} : { isReadOnly: true, readOnlyReason })}
        {...(errors.description === undefined ? {} : { error: errors.description })}
      />
      <AttributeEditor
        attribute={attributeOf('task-due', strings.dueDate, 'date', readOnlyReason)}
        value={dueOn ?? null}
        surface="form"
        onCommit={(value) => {
          onChange({ dueOn: typeof value === 'string' ? value : null });
        }}
        {...(errors.dueOn === undefined ? {} : { error: errors.dueOn })}
      />
      <AttributeEditor
        attribute={attributeOf('task-assignee', strings.assignee, 'actor_reference', readOnlyReason)}
        value={assigneeMemberId === undefined ? null : { type: 'member', id: assigneeMemberId }}
        {...(assignee === undefined ? {} : { display: assignee })}
        surface="form"
        {...(me === undefined ? {} : { me })}
        onSearch={editorSearch((query: string) =>
          // By name or email, Me pinned while the search is empty and first among the matches once typed.
          arraySource(searchMembers(memberDisplays, query, me?.id ?? undefined), (member) => member.id ?? member.name),
        )}
        onCommit={(value) => {
          onChange({ assigneeMemberId: memberIdOf(value) });
        }}
        {...(errors.assignee === undefined ? {} : { error: errors.assignee })}
      />
      <AttributeEditor
        attribute={attributeOf('task-records', strings.records, 'record_reference', recordsReason)}
        value={records.map((record) => ({ objectId: record.objectId, recordId: record.recordId }))}
        display={records}
        surface="form"
        onSearch={editorSearch(search.onSearch)}
        objectSwitcher={{
          // Only objects the person may change: a link to any other would be refused (AC-447).
          objects: writable.map((object) => ({
            id: object.id,
            label: object.pluralName,
            icon: object.icon,
            hue: object.hue,
          })),
          objectId,
          onObjectChange: setObjectId,
        }}
        onCommit={(value) => {
          const next = (Array.isArray(value) ? value : []) as readonly {
            readonly objectId: string;
            readonly recordId: string;
          }[];
          const held = new Set(records.map((record) => record.recordId));
          const nextIds = new Set(next.map((ref) => ref.recordId));
          const added = next.filter((ref) => !held.has(ref.recordId));
          // Linking needs write on the record's object: said under the field, nothing sent (AC-447).
          if (added.some((ref) => byId.get(ref.objectId)?.access !== 'write')) {
            setRecordsError(strings.linkForbidden);
            return;
          }
          if (next.length > TASK_RECORDS_MAX) {
            setRecordsError(strings.recordsFull(TASK_RECORDS_MAX));
            return;
          }
          setRecordsError(undefined);
          onChange({
            addRecords: added.map(
              (ref) =>
                search.displayOf(ref.recordId) ?? {
                  objectId: ref.objectId,
                  recordId: ref.recordId,
                  name: '',
                  kind: 'other',
                },
            ),
            removeRecordIds: records.filter((record) => !nextIds.has(record.recordId)).map((record) => record.recordId),
          });
        }}
        {...((recordsError ?? errors.records ?? (search.failed ? strings.searchFailed : undefined)) === undefined
          ? {}
          : { error: recordsError ?? errors.records ?? strings.searchFailed })}
      />
    </>
  );
}

/** A refusal's words, under the field the change named (the first one it touched). */
function fieldOf(change: TaskChange): FieldName {
  if (change.title !== undefined) return 'title';
  if (change.description !== undefined) return 'description';
  if (change.isDone !== undefined) return 'isDone';
  if (change.dueOn !== undefined) return 'dueOn';
  if (change.assigneeMemberId !== undefined) return 'assignee';
  return 'records';
}

/** The panel's shell for a saved task, whatever state it is in: the record panel's, with a task as its subject. */
function TaskShell({
  title,
  onClose,
  onPrevious,
  onNext,
  status,
  onRetry,
  actions,
  quickActions,
  empty,
  notice,
  isStepping,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly onPrevious?: () => void;
  readonly onNext?: () => void;
  readonly status?: 'ready' | 'loading' | 'error';
  readonly onRetry?: () => void;
  readonly actions?: ReactNode;
  readonly quickActions?: ReactNode;
  readonly empty?: ReactNode;
  /** One line over the body that never scrolls away: a refused tick, which belongs to the header's quick action. */
  readonly notice?: ReactNode;
  /** The next task is on its way (a step): this one stays, with the panel's thin progress line over it. */
  readonly isStepping?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <RecordPanel
      subject={{
        title,
        icon: SUBJECT_ICON,
        previousLabel: strings.previousTask,
        nextLabel: strings.nextTask,
        failedLabel: strings.loadFailed,
        loadingLabel: strings.loading,
      }}
      width="lg"
      isOpen
      onClose={onClose}
      {...(onPrevious === undefined ? {} : { onPrevious })}
      {...(onNext === undefined ? {} : { onNext })}
      {...(status === undefined ? {} : { status })}
      {...(onRetry === undefined ? {} : { onRetry })}
      {...(actions === undefined ? {} : { actions })}
      {...(quickActions === undefined ? {} : { quickActions })}
      {...(empty === undefined ? {} : { empty })}
      {...(notice === undefined ? {} : { notice })}
      {...(isStepping === undefined ? {} : { isStepping })}
      {...(children === undefined ? {} : { body: children })}
    />
  );
}

/** A saved task: each field committed as it changes, optimistic, rolled back with the message under it. */
function SavedTask({
  slug,
  subscription,
  objects,
  startObjectId,
  members,
  meId,
  onClose,
  onPrevious,
  onNext,
  listLabel,
}: Omit<TaskPanelProps, 'task' | 'pageRecord'> & { readonly subscription: TaskSubscription }) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const state = useTask(subscription);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  // The task last read: a step keeps it on screen while the next one loads, so the panel never empties and fills
  // again (the record panel's `isStepping`, which it shows as a thin line over the body).
  const [held, setHeld] = useState<TaskView | undefined>(undefined);
  if (state.task !== undefined && state.task !== held) setHeld(state.task);
  const steps = { ...(onPrevious === undefined ? {} : { onPrevious }), ...(onNext === undefined ? {} : { onNext }) };
  if (state.status === 'error') {
    return <TaskShell title={strings.task} onClose={onClose} status="error" onRetry={subscription.retry} {...steps} />;
  }
  if (state.status === 'missing') {
    return (
      <TaskShell
        title={strings.task}
        onClose={onClose}
        empty={<EmptyState icon="search" title={strings.missing} />}
        {...steps}
      />
    );
  }
  const task: TaskView | undefined = state.task ?? held;
  if (task === undefined) {
    return <TaskShell title={strings.task} onClose={onClose} status="loading" {...steps} />;
  }
  const change = (next: TaskChange) => {
    const field = fieldOf(next);
    setErrors((held) => ({ ...held, [field]: undefined }));
    void data.tasks.update(slug, task.id, next).then((failure: DataError | undefined) => {
      if (failure !== undefined) {
        setErrors((held) => ({ ...held, [field]: refusalSummary(failure) }));
        return;
      }
      // Handing it to somebody else reaches them: the toast names that, since nothing on this screen shows it.
      const handedOn = next.assigneeMemberId;
      if (handedOn !== undefined && handedOn !== null && handedOn !== meId) {
        toasts.toast({
          tone: 'success',
          message: strings.assigned,
          consequence: strings.assignedConsequence(memberDisplay(members, handedOn).name),
        });
      }
    });
  };
  // Deleting acts at once, with no confirm, and offers Undo for 10 seconds (AC-445).
  const remove = () => {
    const taskId = task.id;
    onClose();
    deleteWithUndo({
      toasts,
      remove: () => data.tasks.remove(slug, taskId),
      restore: () => data.tasks.restore(slug, taskId),
      words: {
        deleted: strings.taskDeleted,
        undo: strings.undo,
        notDeleted: (reason) => `${strings.notDeleted} ${reason}`,
        notRestored: (reason) => `${strings.notRestored} ${reason}`,
      },
      ...(listLabel === undefined ? {} : { listLabel }),
    });
  };
  const copyLink = () => {
    const href = new URL(window.location.href);
    href.searchParams.set('task', task.id);
    navigator.clipboard.writeText(href.href).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.linkCopied });
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.copyFailed });
      },
    );
  };
  const creator =
    task.createdBy.type === 'member' && task.createdBy.id !== null
      ? memberDisplay(members, task.createdBy.id).name
      : task.createdBy.type === 'api_key'
        ? strings.apiKey
        : task.createdBy.type === 'automation'
          ? strings.automation
          : strings.system;
  return (
    <TaskShell
      title={task.title}
      onClose={onClose}
      {...steps}
      // A step on its way: this task stays, with the thin line over it, rather than the panel emptying.
      isStepping={state.status === 'loading'}
      // A refused tick belongs to the quick action in the header, so it sits over the body rather than inside it.
      {...(errors.isDone === undefined
        ? {}
        : {
            notice: (
              <Callout tone="danger" isAnnounced>
                {errors.isDone}
              </Callout>
            ),
          })}
      // The one action the panel is opened for, where the eye lands: Done was a checkbox among the fields. Read
      // only, it says why on hover and focus, as the checkbox's description did.
      quickActions={
        <Tooltip content={strings.readOnly} isDisabled={task.canChange}>
          <Button
            variant={task.isDone ? 'secondary' : 'primary'}
            icon={task.isDone ? 'undo-2' : 'check'}
            isDisabled={!task.canChange}
            onPress={() => {
              change({ isDone: !task.isDone });
            }}
          >
            {task.isDone ? strings.reopen : strings.markDone}
          </Button>
        </Tooltip>
      }
      actions={
        // More: Copy link, and Delete task for someone who may change it (milestone 4).
        <MenuTrigger>
          <Tooltip content={strings.more}>
            <Button variant="ghost" icon="ellipsis" label={strings.more} />
          </Tooltip>
          <Menu
            label={strings.more}
            onAction={(key) => {
              if (key === 'copy') copyLink();
              if (key === 'delete') remove();
            }}
          >
            <MenuItem id="copy" icon="link">
              {strings.copyLink}
            </MenuItem>
            {task.canChange ? (
              <MenuItem id="delete" icon="trash" isDanger>
                {strings.deleteTask}
              </MenuItem>
            ) : null}
          </Menu>
        </MenuTrigger>
      }
    >
      <Form id={`task-${task.id}`} onSubmit={() => undefined} label={strings.task}>
        <TaskFields
          slug={slug}
          title={task.title}
          description={task.description}
          isSaved
          dueOn={task.dueOn}
          assigneeMemberId={task.assigneeMemberId}
          records={task.records}
          objects={objects}
          startObjectId={startObjectId}
          members={members}
          meId={meId}
          errors={errors}
          onChange={change}
          {...(task.canChange ? {} : { readOnlyReason: strings.readOnly })}
        />
        <DescriptionList
          layout="stacked"
          items={[
            {
              term: strings.created,
              description: (
                <>
                  {creator} · <RelativeTime value={task.createdAt} />
                </>
              ),
            },
          ]}
        />
      </Form>
    </TaskShell>
  );
}

/**
 * A new task: a dialog, not the panel. It is one short create form with its own Create, and a panel that asks
 * before anything exists would hold a footer the record panel has no room for (31 October 2026's header pattern).
 * Its fields are held here until Create, which closes it at once (optimistic).
 */
function NewTask({
  slug,
  pageRecord,
  objects,
  startObjectId,
  members,
  meId,
  onClose,
  onOpenTask,
}: Omit<TaskPanelProps, 'task' | 'onPrevious' | 'onNext'>) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const formId = useId();
  // One id per opening, sent again on Retry.
  const [id] = useState(() => data.tasks.newId());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueOn, setDueOn] = useState<string | undefined>(undefined);
  const [assignee, setAssignee] = useState<string | undefined>(meId);
  const [records, setRecords] = useState<readonly RecordRefDisplay[]>(pageRecord === undefined ? [] : [pageRecord]);
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const create = () => {
    const trimmed = title.trim();
    if (trimmed === '') {
      setTitleError(strings.titleRequired);
      return;
    }
    void data.tasks.create(slug, {
      id,
      title: trimmed,
      ...(description.trim() === '' ? {} : { description: description.trim() }),
      ...(dueOn === undefined ? {} : { dueOn }),
      ...(assignee === undefined ? {} : { assigneeMemberId: assignee }),
      records,
      ...(meId === undefined ? {} : { createdBy: meId }),
    });
    onClose();
    // Says it was made, with Open: a task made off its list (⌘K, another page) would otherwise vanish unseen.
    if (onOpenTask !== undefined) {
      toasts.toast(
        taskCreatedToast(() => {
          onOpenTask(id);
        }),
      );
    }
  };
  return (
    <TaskModal
      title={strings.newTask}
      onClose={onClose}
      actions={
        <>
          <Button slot="close" onPress={onClose}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            {strings.createTask}
          </Button>
        </>
      }
    >
      <Form id={formId} onSubmit={create} label={strings.newTask} focusesFirstField>
        <TaskFields
          slug={slug}
          title={title}
          description={description}
          isSaved={false}
          dueOn={dueOn}
          assigneeMemberId={assignee}
          records={records}
          objects={objects}
          startObjectId={startObjectId}
          members={members}
          meId={meId}
          errors={titleError === undefined ? {} : { title: titleError }}
          onTitleInput={(next) => {
            setTitle(next);
            if (next.trim() !== '') setTitleError(undefined);
          }}
          onDescriptionInput={setDescription}
          onChange={(change) => {
            if (change.title !== undefined) setTitle(change.title);
            if (change.description !== undefined) setDescription(change.description);
            if (change.dueOn !== undefined) setDueOn(change.dueOn ?? undefined);
            if (change.assigneeMemberId !== undefined) setAssignee(change.assigneeMemberId ?? undefined);
            if (change.addRecords !== undefined || change.removeRecordIds !== undefined) {
              const removed = new Set(change.removeRecordIds ?? []);
              setRecords((held) => [
                ...held.filter((record) => !removed.has(record.recordId)),
                ...(change.addRecords ?? []),
              ]);
            }
          }}
        />
      </Form>
    </TaskModal>
  );
}

/** The new task dialog's frame: the library's Modal, open while the address names `new`. */
function TaskModal({
  title,
  onClose,
  actions,
  headerActions,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly actions?: ReactNode;
  /** Icon buttons in the title bar, before Close (Copy link). */
  readonly headerActions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      {...(actions === undefined ? {} : { actions })}
      {...(headerActions === undefined ? {} : { headerActions })}
    >
      {children}
    </Modal>
  );
}

/**
 * The task panel (AC-434): a saved task beside the page, each field committed
 * as it changes and live, with Previous and Next where a list opened it; a
 * task that doesn't exist, was deleted, or is hidden says so. `new` is still
 * a dialog, since it is a create form with its own button.
 */
export function TaskPanel(props: TaskPanelProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const [subscription, setSubscription] = useState<TaskSubscription | 'failed' | undefined>(undefined);
  // Moves on Try again after the task's code failed to load.
  const [attempt, setAttempt] = useState(0);
  const { slug, task } = props;
  useEffect(() => {
    if (task === 'new') return;
    let isLive = true;
    data.tasks.one(slug, task).then(
      (found) => {
        if (isLive) setSubscription(found);
      },
      () => {
        // The store's code didn't load (offline): the panel says so, with Try again.
        if (isLive) setSubscription('failed');
      },
    );
    return () => {
      isLive = false;
    };
  }, [data, slug, task, attempt]);
  if (task === 'new') return <NewTask {...props} />;
  // One SavedTask (so one Panel) from the first frame: a placeholder that says loading until the store's lands.
  const shown =
    subscription === 'failed'
      ? failedTask(() => {
          setSubscription(undefined);
          setAttempt((at) => at + 1);
        })
      : (subscription ?? LOADING_TASK);
  return <SavedTask {...props} subscription={shown} />;
}
