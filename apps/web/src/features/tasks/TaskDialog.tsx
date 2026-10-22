// Brief
// Purpose: everything about one task, on `?task=<id>` (or `?task=new`) over the page it opened from.
// Main task: set its title, when it's due, who has it and which records it is about.
// Leaves out: comments on tasks, reminders (#28), subtasks.
import {
  refusalSummary,
  TASK_RECORDS_MAX,
  TASK_TITLE_MAX,
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
  Checkbox,
  DescriptionList,
  EmptyState,
  Field,
  Form,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  RelativeTime,
  Tooltip,
  type AttributeEditorProps,
  type FieldAttribute,
  type ListSource,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { memberDisplay } from './entries.ts';
import { deleteWithUndo } from './undo-delete.ts';
import { strings } from './strings.ts';
import { useRecordSearch } from '../records/links.ts';

/** Props for the task dialog. */
export interface TaskDialogProps {
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
}

/**
 * A search of one display shape as the editor takes it: AttributeEditor types
 * its search over every attribute type's display, and each editor reads only
 * its own.
 */
const editorSearch = <T,>(search: (query: string) => ListSource<T>) =>
  search as unknown as NonNullable<AttributeEditorProps['onSearch']>;

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
type FieldName = 'title' | 'isDone' | 'dueOn' | 'assignee' | 'records';

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
  readonly isDone?: boolean;
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
}

/** The title, Done (a saved task only), due date, assignee and records, each through its one editor. */
function TaskFields({
  slug,
  title,
  isDone,
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
}: TaskFieldsProps) {
  const [draft, setDraft] = useState(title);
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
  const isSaved = isDone !== undefined;
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
      {isDone !== undefined && (
        <Checkbox
          label={strings.done}
          isSelected={isDone}
          isReadOnly={readOnlyReason !== undefined}
          {...(readOnlyReason === undefined ? {} : { description: readOnlyReason })}
          onChange={(next) => {
            onChange({ isDone: next });
          }}
          {...(errors.isDone === undefined ? {} : { error: errors.isDone })}
        />
      )}
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
        onSearch={editorSearch((query) =>
          arraySource(
            memberDisplays.filter((member) => member.name.toLowerCase().includes(query.trim().toLowerCase())),
            (member) => member.id ?? member.name,
          ),
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
  if (change.isDone !== undefined) return 'isDone';
  if (change.dueOn !== undefined) return 'dueOn';
  if (change.assigneeMemberId !== undefined) return 'assignee';
  return 'records';
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
  listLabel,
}: Omit<TaskDialogProps, 'task' | 'pageRecord'> & { readonly subscription: TaskSubscription }) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const state = useTask(subscription);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const close = (
    <Button slot="close" onPress={onClose}>
      {strings.close}
    </Button>
  );
  if (state.status === 'loading') {
    return (
      <TaskModal title={strings.task} onClose={onClose}>
        <EmptyState isLoading title={strings.loading} />
      </TaskModal>
    );
  }
  if (state.status === 'error') {
    return (
      <TaskModal title={strings.task} onClose={onClose} actions={close}>
        <EmptyState tone="error" title={strings.loadFailed} onRetry={subscription.retry} />
      </TaskModal>
    );
  }
  const task: TaskView | undefined = state.task;
  if (state.status === 'missing' || task === undefined) {
    return (
      <TaskModal title={strings.task} onClose={onClose} actions={close}>
        <EmptyState icon="search" title={strings.missing} />
      </TaskModal>
    );
  }
  const change = (next: TaskChange) => {
    const field = fieldOf(next);
    setErrors((held) => ({ ...held, [field]: undefined }));
    void data.tasks.update(slug, task.id, next).then((failure: DataError | undefined) => {
      if (failure !== undefined) setErrors((held) => ({ ...held, [field]: refusalSummary(failure) }));
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
    <TaskModal
      title={strings.task}
      onClose={onClose}
      headerActions={
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
          isDone={task.isDone}
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
    </TaskModal>
  );
}

/** A new task: its fields held here until Create, which closes the dialog at once (optimistic). */
function NewTask({ slug, pageRecord, objects, startObjectId, members, meId, onClose }: Omit<TaskDialogProps, 'task'>) {
  const { data } = useRouteContext({ from: '__root__' });
  const formId = useId();
  // One id per opening, sent again on Retry.
  const [id] = useState(() => data.tasks.newId());
  const [title, setTitle] = useState('');
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
      ...(dueOn === undefined ? {} : { dueOn }),
      ...(assignee === undefined ? {} : { assigneeMemberId: assignee }),
      records,
      ...(meId === undefined ? {} : { createdBy: meId }),
    });
    onClose();
  };
  return (
    <TaskModal
      title={strings.newTask}
      onClose={onClose}
      actions={
        <>
          <Button slot="close" onPress={onClose} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} kbd="⌘↵">
            {strings.createTask}
          </Button>
        </>
      }
    >
      <Form id={formId} onSubmit={create} label={strings.newTask} focusesFirstField>
        <TaskFields
          slug={slug}
          title={title}
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
          onChange={(change) => {
            if (change.title !== undefined) setTitle(change.title);
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

/** The dialog's frame: the library's Modal, open while the address names a task. */
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
 * The task dialog (AC-434): a new task's fields until Create, or a saved
 * task's, each committed as it changes and live; a task that doesn't exist,
 * was deleted, or is hidden says so.
 */
export function TaskDialog(props: TaskDialogProps) {
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
        // The store's code didn't load (offline): the dialog says so, with Try again.
        if (isLive) setSubscription('failed');
      },
    );
    return () => {
      isLive = false;
    };
  }, [data, slug, task, attempt]);
  if (task === 'new') return <NewTask {...props} />;
  // One SavedTask (so one Modal) from the first frame: a placeholder that says loading until the store's lands.
  const shown =
    subscription === 'failed'
      ? failedTask(() => {
          setSubscription(undefined);
          setAttempt((at) => at + 1);
        })
      : (subscription ?? LOADING_TASK);
  return <SavedTask {...props} subscription={shown} />;
}
