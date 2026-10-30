// Brief
// Purpose: glance at a record beside its table or board, and change it, without leaving the list (Twenty's side panel).
// Main task: read and edit its details, then step to the record above or below with ↑ and ↓ and keep going.
// Leaves out: Overview, the stat strip and the record's menu (delete, copy link), all on its full page one press away.
import type { AttributeDefinition, MemberSummary, ObjectSummary, RecordState, RecordView } from '@crm/data';
import { useCommentCount, useNoteTotal, useRecord, useTaskTotal } from '@crm/data/react';
import { Callout, EmptyState, RecordPanel, type RecordPanelTab } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommentsTab } from '../comments/CommentsTab.tsx';
import { strings as commentStrings } from '../comments/strings.ts';
import { NotesTab } from '../notes/NotesTab.tsx';
import { strings as noteStrings } from '../notes/strings.ts';
import { NoteWindow } from '../notes/NoteWindow.tsx';
import { tabCount } from '../tasks/entries.ts';
import { strings as taskStrings } from '../tasks/strings.ts';
import { TaskDialog } from '../tasks/TaskDialog.tsx';
import { TasksTab } from '../tasks/TasksTab.tsx';
import { ActivityTab } from './ActivityTab.tsx';
import { recordHref, recordName } from './details.ts';
import type { PeekLoadStep, PeekSteps, PeekTab } from './params.ts';
import { openPeek, type PeekSources } from './peek.ts';
import { RecordDetails } from './RecordDetails.tsx';
import { RelatedSections } from './RelatedSections.tsx';
import { strings } from './strings.ts';
import { recordLinks } from './timeline.ts';

/** Props for the record panel over a table or board. */
export interface RecordPeekProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** The object's live attributes, as the view holds them. */
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  /** `?record=`: the record shown. */
  readonly recordId: string;
  /** `?panelTab=`: the tab shown. */
  readonly tab: PeekTab;
  readonly onTabChange: (tab: PeekTab) => void;
  /** Steps through the list beside it (↑ and ↓, Previous and Next); undefined when the record isn't among its rows. */
  readonly steps?: PeekSteps;
  /**
   * Loads the row beside the record when the list has it but hasn't loaded it (`steps.isNextPending`), answering its
   * id, or undefined when it doesn't arrive. Keep it stable: the panel draws again only when what it shows changes.
   */
  readonly onLoadStep?: PeekLoadStep;
  /** Shows another record: a step, or a row picked in the list. */
  readonly onOpen: (recordId: string) => void;
  readonly onClose: () => void;
}

/** How long a step waits before opening its record, so a held ↓ opens only where it stops. */
const STEP_SETTLE_MS = 150;

/**
 * The record panel: its sources opened through the data layer, then the record in whichever state it is. The panel
 * draws once the first record's sources are in (the table already holds its body, so that is a moment), and a step
 * keeps the last record's until the next one's arrive, so the panel never slides in twice nor flashes empty.
 */
function RecordPeekPanel(props: RecordPeekProps) {
  const { slug, object, attributes, recordId } = props;
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  // A step to a row the list hasn't loaded: it loads the row's block, then opens the record. One at a time; it
  // names the record it started from, so it is over once the panel shows another.
  const [step, setStep] = useState<{ readonly from: string; readonly controller: AbortController } | undefined>(
    undefined,
  );
  const { onLoadStep, onOpen } = props;
  const loadStep = useCallback(
    (direction: 'previous' | 'next') => {
      if (onLoadStep === undefined) return;
      step?.controller.abort();
      const controller = new AbortController();
      setStep({ from: recordId, controller });
      void onLoadStep(direction, controller.signal).then((id) => {
        if (controller.signal.aborted) return;
        setStep(undefined);
        if (id !== undefined) onOpen(id);
      });
    },
    [onLoadStep, onOpen, recordId, step],
  );
  // A load is let go when another replaces it, the record changes some other way (a row picked, Close), or the
  // panel goes.
  useEffect(
    () => () => {
      step?.controller.abort();
    },
    [step, recordId],
  );
  // The last sources that arrived, whichever record they are for, and a record whose sources failed to open.
  const [held, setHeld] = useState<PeekSources | undefined>(undefined);
  const [failedFor, setFailedFor] = useState<string | undefined>(undefined);
  // Whether a record shows yet: the first opens at once; a step waits a moment, so holding ↓ opens only the record
  // it stops on rather than every one it passes.
  const isShowing = useRef(false);
  useEffect(() => {
    let isCurrent = true;
    const open = () => {
      openPeek(data, slug, object, attributes, recordId).then(
        (sources) => {
          if (!isCurrent) return;
          isShowing.current = true;
          setHeld(sources);
          setFailedFor(undefined);
        },
        () => {
          if (isCurrent) setFailedFor(recordId);
        },
      );
    };
    const timer = isShowing.current ? setTimeout(open, STEP_SETTLE_MS) : undefined;
    if (timer === undefined) open();
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [data, slug, object, attributes, recordId, attempt]);
  if (failedFor === recordId) {
    return (
      <RecordPanel
        isOpen
        width="lg"
        status="error"
        onRetry={() => {
          setAttempt((count) => count + 1);
        }}
        onClose={props.onClose}
        {...stepProps(props, loadStep)}
        onOpenPage={() => {
          void navigate({ href: pageHref(props) });
        }}
        tabs={[]}
      />
    );
  }
  if (held === undefined) return null;
  return (
    <LoadedPeek
      {...props}
      sources={held}
      loadStep={loadStep}
      // The next record is on its way: the one before stays, with a quiet line over it.
      isStepping={step?.from === recordId || held.recordId !== recordId}
    />
  );
}

/**
 * The panel over a table or board. It draws again only when what it shows changes: the list beside it renders on
 * every scroll and live patch, and hands it a new steps object each time with the same two ids.
 */
export const RecordPeek = memo(
  RecordPeekPanel,
  (before, after) =>
    before.slug === after.slug &&
    before.object === after.object &&
    before.attributes === after.attributes &&
    before.members === after.members &&
    before.recordId === after.recordId &&
    before.tab === after.tab &&
    before.onTabChange === after.onTabChange &&
    before.onOpen === after.onOpen &&
    before.onClose === after.onClose &&
    before.onLoadStep === after.onLoadStep &&
    before.steps?.previous === after.steps?.previous &&
    before.steps?.next === after.steps?.next &&
    before.steps?.isPreviousPending === after.steps?.isPreviousPending &&
    before.steps?.isNextPending === after.steps?.isNextPending &&
    (before.steps === undefined) === (after.steps === undefined),
);

/**
 * Previous and Next, from the steps the list worked out; both left out when the list doesn't hold the record. A
 * neighbour the list has but hasn't loaded keeps its button on: pressing it loads the row and moves on, so a step
 * is off only at the list's real end.
 */
function stepProps(
  { steps, onOpen, onLoadStep }: Pick<RecordPeekProps, 'steps' | 'onOpen' | 'onLoadStep'>,
  loadStep: (direction: 'previous' | 'next') => void,
) {
  if (steps === undefined) return {};
  const { previous, next } = steps;
  const canLoad = onLoadStep !== undefined;
  return {
    ...(previous !== undefined
      ? { onPrevious: () => onOpen(previous) }
      : steps.isPreviousPending === true && canLoad
        ? {
            onPrevious: () => {
              loadStep('previous');
            },
          }
        : {}),
    ...(next !== undefined
      ? { onNext: () => onOpen(next) }
      : steps.isNextPending === true && canLoad
        ? {
            onNext: () => {
              loadStep('next');
            },
          }
        : {}),
  };
}

/** The full page's address on the tab the panel shows (Details is the page's Overview). */
const pageHref = ({ slug, object, recordId, tab }: Pick<RecordPeekProps, 'slug' | 'object' | 'recordId' | 'tab'>) =>
  recordHref(slug, object.apiSlug, recordId, tab === 'details' ? 'overview' : tab);

/** No tabs, while the record loads or isn't there: one array, so the panel's memo holds. */
const NO_TABS: readonly RecordPanelTab[] = [];

/** The record shown, or the last one shown when it went while open (read only, with the notice). */
function shownOf(state: RecordState): RecordView | undefined {
  if (state.status === 'deleted') return state.isLost ? state.record : undefined;
  return state.status === 'ready' ? state.record : undefined;
}

function LoadedPeek(
  props: RecordPeekProps & {
    readonly sources: PeekSources;
    readonly loadStep: (direction: 'previous' | 'next') => void;
    readonly isStepping: boolean;
  },
) {
  const { slug, object, members, tab, onTabChange, onClose, sources } = props;
  // The record these sources are for: the one asked for once its sources arrive, the last one until then.
  const { recordId } = sources;
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const state = useRecord(sources.record);
  const openTotal = useTaskTotal(sources.open);
  const notesTotal = useNoteTotal(sources.notes);
  const commentCount = useCommentCount(sources.comments);
  const link = useMemo(() => recordLinks(slug, sources.objects), [slug, sources.objects]);
  const chipHref = useCallback(
    (display: { readonly objectId: string; readonly recordId: string }) => link(display.objectId, display.recordId),
    [link],
  );
  const feedFor = useCallback(
    (kinds: Parameters<typeof data.activity.forRecord>[3]) => data.activity.forRecord(slug, recordId, object.id, kinds),
    [data, slug, recordId, object.id],
  );
  // A task or note opens over the panel, as on the page; their address stays the list's, so closing leaves the panel.
  const [task, setTask] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  // Stepping to another record closes what was open on the last one.
  const [shownFor, setShownFor] = useState(recordId);
  if (shownFor !== recordId) {
    setShownFor(recordId);
    setTask(undefined);
    setNote(undefined);
  }
  const shown = shownOf(state);
  const isLost = state.status === 'deleted' && state.isLost;
  const canEdit = !isLost && object.access === 'write' && state.status === 'ready';
  const name = shown === undefined ? undefined : recordName(shown, object, strings.unnamed(object.singularName));
  const display = shown === undefined || name === undefined ? undefined : { ...shown.display, name };
  const openPage = () => {
    void navigate({ href: pageHref({ ...props, recordId }) });
  };
  const common = {
    isOpen: true,
    width: 'lg' as const,
    onClose,
    onOpenPage: openPage,
    isStepping: props.isStepping,
    ...stepProps(props, props.loadStep),
  };

  // One panel in every state, so it never mounts again (and slides in again) as the record's state changes.
  if (state.status === 'deleted' && !state.isLost) {
    // Missing or hidden: one state, one string (AC-376, AC-384); the header keeps Close.
    return (
      <RecordPanel
        {...common}
        tabs={NO_TABS}
        empty={
          <EmptyState icon="search" title={strings.recordUnavailable}>
            {strings.recordUnavailableText}
          </EmptyState>
        }
      />
    );
  }
  if (state.status === 'error') {
    return <RecordPanel {...common} status="error" onRetry={sources.record.retry} tabs={NO_TABS} />;
  }
  if (display === undefined || shown === undefined) return <RecordPanel {...common} status="loading" tabs={NO_TABS} />;

  const tabs: readonly RecordPanelTab[] = [
    {
      id: 'details',
      label: strings.details,
      content: (
        <>
          <RecordDetails
            attributes={sources.attributes}
            members={members}
            record={shown}
            cellErrors={state.cellErrors}
            referenceDisplays={state.referenceDisplays}
            {...(canEdit
              ? {
                  onCommit: (attributeId: string, value: unknown) => {
                    data.records.setValue(slug, { rowId: recordId, columnId: attributeId, value });
                  },
                }
              : {})}
          />
          {!isLost && (
            <RelatedSections
              slug={slug}
              recordId={recordId}
              related={sources.related}
              canChange={canEdit}
              link={link}
            />
          )}
        </>
      ),
    },
    {
      id: 'activity',
      label: strings.activity,
      content: <ActivityTab feed={sources.feed} feedFor={feedFor} link={link} />,
    },
    {
      id: 'notes',
      label: noteStrings.notes,
      ...tabCount(notesTotal),
      content: <NotesTab list={sources.notes} members={members} canAdd={canEdit} onOpenNote={setNote} />,
    },
    {
      id: 'tasks',
      label: taskStrings.tasks,
      ...tabCount(openTotal),
      content: (
        <TasksTab
          slug={slug}
          record={display}
          open={sources.open}
          members={members}
          meId={sources.meId}
          canAdd={canEdit}
          recordHref={chipHref}
          onOpenTask={setTask}
        />
      ),
    },
    {
      id: 'comments',
      label: commentStrings.comments,
      ...tabCount(commentCount === undefined ? undefined : { count: commentCount, atLeast: false }),
      content: (
        <CommentsTab
          slug={slug}
          recordId={recordId}
          comments={sources.comments}
          members={members}
          meId={sources.meId}
          isReadOnly={isLost}
        />
      ),
    },
  ];
  return (
    <>
      <RecordPanel
        {...common}
        record={display}
        selectedTab={tab}
        onTabChange={(next) => {
          const found = tabs.find((each) => each.id === next);
          if (found !== undefined) onTabChange(found.id as PeekTab);
        }}
        tabs={tabs}
        {...(isLost
          ? {
              notice: (
                <Callout tone="danger" isAnnounced>
                  {strings.noLongerAvailable(object.singularName)}
                </Callout>
              ),
            }
          : {})}
      />
      {task !== undefined && (
        <TaskDialog
          slug={slug}
          task={task}
          {...(canEdit ? { pageRecord: display } : {})}
          startObjectId={object.id}
          objects={sources.objects}
          members={members}
          meId={sources.meId}
          onClose={() => {
            setTask(undefined);
          }}
          onOpenTask={setTask}
          listLabel={taskStrings.openTasks}
        />
      )}
      {note !== undefined && (
        <NoteWindow
          slug={slug}
          note={note}
          record={display}
          recordHref={recordHref(slug, object.apiSlug, recordId, 'notes')}
          members={members}
          objects={sources.objects}
          hrefOf={chipHref}
          canChange={canEdit}
          onStored={setNote}
          onClose={() => {
            setNote(undefined);
          }}
        />
      )}
    </>
  );
}
