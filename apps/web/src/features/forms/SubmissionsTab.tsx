// Brief
// Purpose: a form's submissions (spec 0023): who sent what and when, newest first, with what needs a look on top.
// Main task: scan the people and their first answers, open one in full, settle many at once (spam or not), and get
// any that aren't in the CRM there (Add to CRM, Sync earlier submissions); take them out as CSV.
// Leaves out: counts per state, server search (search filters the rows loaded so far), and live arrival.
import {
  isDataError,
  type JobView,
  type ObjectSummary,
  type SubmissionAnswer,
  type SubmissionPage,
  type SubmissionState,
  type SubmissionSummary,
  type SubmissionView,
} from '@crm/data';
import {
  BulkActionBar,
  Button,
  Callout,
  CopyButton,
  DescriptionList,
  EmptyState,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  Panel,
  RecordChip,
  RelativeTime,
  LinkListToolbar,
  Select,
  Table,
  TruncatedText,
  type TableColumn,
} from '@crm/ui';
// eslint-disable-next-line no-restricted-imports -- a submission's state, not an attribute value
import { StatusDot } from '@crm/ui';
import { useNavigate, useRouter, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { recordLinks } from '../records/timeline.ts';
import { formHref } from './paths.ts';
import { strings } from './strings.ts';
import { SyncDialog } from './SyncDialog.tsx';
import { useFormToolbarSlot } from './toolbarSlot.ts';

/** Props for the Submissions tab: what its route loaded through the data layer. */
export interface SubmissionsTabProps {
  readonly slug: string;
  readonly formId: string;
  readonly objects: readonly ObjectSummary[];
  readonly page: SubmissionPage;
  readonly state: SubmissionState | undefined;
  readonly open: SubmissionView | undefined;
  readonly canManage: boolean;
  /** The form's questions, for the answer columns (the first two) by their labels; the `name` one names the person. */
  readonly questions: readonly { readonly id: string; readonly key: string; readonly label: string }[];
  /** The form's public link, for the empty state's Copy link. */
  readonly link: string;
  /** Follows a job this tab started to its end; the editor holds it, so a tab change never loses the result. */
  readonly followJob: (jobId: string, onDone: (job: JobView) => void) => void;
  /** The live form adds submissions to the CRM; one that keeps them only offers no Add to CRM or sync. */
  readonly isFiling: boolean;
}

/** How many answers get a column of their own; the rest are in the open submission. */
const ANSWER_COLUMNS = 2;

/** The most one Add to CRM call names (the contract's ADD_TO_CRM_MAX). */
const ADD_MAX = 500;

/** The most one export by id names (the contract's EXPORT_IDS_MAX). */
const EXPORT_MAX = 1_000;

const ALL = 'all';

/** The email column's id: a question's id is lower case letters, digits, - and _, so none looks like it. */
const EMAIL_COLUMN = ':email';
const FILTERS: readonly SubmissionState[] = ['processed', 'needs_review', 'spam', 'failed'];

/** Each state's dot: filed green, a look needed orange, failed red, the rest gray. */
const STATE_HUES = {
  received: 'gray',
  processing: 'gray',
  processed: 'green',
  spam: 'gray',
  held: 'gray',
  needs_review: 'orange',
  failed: 'red',
} as const satisfies Record<SubmissionState, 'gray' | 'green' | 'orange' | 'red'>;

/** A submission's state in words: a processed one says whether it is in the CRM, or kept where nothing is filed. */
function stateLabel(submission: SubmissionSummary, isFiling: boolean): string {
  if (submission.state !== 'processed' || submission.crm.state === 'linked') return strings.states[submission.state];
  return isFiling ? strings.stateNotInCrm : strings.stateKept;
}

/** Its dot: filed green, a look needed orange, failed red, kept by a form that files nothing green, the rest gray. */
function stateHue(submission: SubmissionSummary, isFiling: boolean): 'gray' | 'green' | 'orange' | 'red' {
  if (submission.state === 'processed' && submission.crm.state !== 'linked') return isFiling ? 'gray' : 'green';
  return STATE_HUES[submission.state];
}

/** An answer as words: text, Yes or No, a phone's number. */
function answerText(answer: SubmissionAnswer): string {
  const { value } = answer;
  if (typeof value === 'boolean') return value ? strings.yes : strings.no;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && typeof (value as { number?: unknown }).number === 'string') {
    return (value as { number: string }).number;
  }
  return '';
}

/** The filter, the table, Show more, and the open submission in a Panel. */
export function SubmissionsTab({
  slug,
  formId,
  objects,
  page,
  state,
  open,
  canManage,
  questions,
  link: formLink,
  followJob,
  isFiling,
}: SubmissionsTabProps) {
  const slot = useFormToolbarSlot();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<{ readonly label: string; readonly value: number } | undefined>(undefined);
  const [isSyncing, setSyncing] = useState(false);
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const router = useRouter();
  const link = recordLinks(slug, objects);
  const [more, setMore] = useState<{
    readonly for: SubmissionPage;
    readonly items: readonly SubmissionSummary[];
    readonly next?: string;
  }>({
    for: page,
    items: [],
    ...(page.nextCursor === undefined ? {} : { next: page.nextCursor }),
  });
  const held =
    more.for === page
      ? more
      : { for: page, items: [], ...(page.nextCursor === undefined ? {} : { next: page.nextCursor }) };
  const rows = [...page.items, ...held.items];
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [isConfirmingDelete, setConfirmingDelete] = useState(false);

  const go = (submissionId?: string, nextState: SubmissionState | undefined = state) => {
    if (nextState !== state) setSelected(new Set());
    const href = formHref(slug, formId, 'submissions', submissionId);
    void navigate({ href: nextState === undefined ? href : `${href}&state=${nextState}` });
  };

  const loadMore = () => {
    const cursor = held.next;
    if (cursor === undefined || busy !== undefined) return;
    setBusy('more');
    data.submissions.list(slug, formId, { ...(state === undefined ? {} : { state }), cursor }).then(
      (next) => {
        setBusy(undefined);
        setMore({
          for: page,
          items: [...held.items, ...next.items],
          ...(next.nextCursor === undefined ? {} : { next: next.nextCursor }),
        });
      },
      (error: unknown) => {
        setBusy(undefined);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
      },
    );
  };

  const act = (kind: 'release' | 'spam' | 'retry' | 'delete', submissionId: string) => {
    setBusy(kind);
    const done =
      kind === 'release'
        ? data.submissions.release(slug, submissionId)
        : kind === 'spam'
          ? data.submissions.markSpam(slug, submissionId)
          : kind === 'retry'
            ? data.submissions.retry(slug, submissionId)
            : data.submissions.delete(slug, submissionId);
    const said = {
      release: strings.released,
      spam: strings.markedSpam,
      retry: strings.retried,
      delete: strings.submissionDeleted,
    };
    done.then(
      () => {
        setBusy(undefined);
        setConfirmingDelete(false);
        toasts.toast({ tone: 'success', message: said[kind] });
        if (kind === 'delete') go(undefined);
        else void router.invalidate();
      },
      (error: unknown) => {
        setBusy(undefined);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
      },
    );
  };

  // The question that names the person (the starting Name question, key `name`): a row not in the CRM shows its
  // answer as the person, and its email in a column of its own.
  const nameQuestion = questions.find((question) => question.key === 'name');
  const nameOf = (submission: SubmissionSummary): string | undefined => {
    const answer = submission.firstAnswers.find((each) => each.questionId === nameQuestion?.id);
    const text = answer === undefined ? '' : answerText(answer).trim();
    return text === '' ? undefined : text;
  };
  // Search narrows the rows loaded so far, by the person's name or email.
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? rows
      : rows.filter((submission) =>
          [submission.mainRecord?.name, nameOf(submission), submission.email].some(
            (text) => text?.toLowerCase().includes(needle) === true,
          ),
        );
  const waiting = rows.filter((submission) => submission.state === 'needs_review').length;
  // What a bulk action acts on: the picked rows still in view (a filter or a search may hide some).
  const picked = shown.filter((submission) => selected.has(submission.id));
  const canRelease = picked.some((submission) => submission.state === 'spam' || submission.state === 'needs_review');
  const canMarkSpam = picked.some((submission) => submission.state !== 'spam');
  const addable = picked.filter((submission) => submission.crm.state === 'not_in_crm' && submission.crm.canAddToCrm);
  const hasEmailColumn = nameQuestion !== undefined && shown.some((submission) => submission.email !== undefined);
  const columns: readonly TableColumn[] = [
    { id: 'person', label: strings.person, isRowHeader: true, isInline: true },
    ...(hasEmailColumn ? [{ id: EMAIL_COLUMN, label: strings.email }] : []),
    { id: 'when', label: strings.when },
    { id: 'state', label: strings.state },
    // The questions the list carries answers for (the server sends each row's first answers), in the form's order,
    // but the one the Person column already says. A question earns a column when some row answered it.
    ...questions
      .filter(
        (question) =>
          question.id !== nameQuestion?.id &&
          shown.some((submission) => {
            const answer = submission.firstAnswers.find((each) => each.questionId === question.id);
            return answer !== undefined && answerText(answer).trim() !== '';
          }),
      )
      .slice(0, ANSWER_COLUMNS)
      .map((question) => ({ id: question.id, label: question.label })),
  ];

  /** Marks every picked submission spam, or not spam, one after another, with progress in the bar. */
  const settleAll = (kind: 'spam' | 'release') => {
    const ids = picked
      .filter((submission) => (kind === 'spam' ? submission.state !== 'spam' : submission.state !== 'processed'))
      .map((submission) => submission.id);
    let done = 0;
    const label = kind === 'spam' ? strings.markingSpam : strings.markingNotSpam;
    setBulk({ label, value: 0 });
    const step = (index: number): Promise<void> => {
      const id = ids[index];
      if (id === undefined) return Promise.resolve();
      const call = kind === 'spam' ? data.submissions.markSpam(slug, id) : data.submissions.release(slug, id);
      return call.then(() => {
        done += 1;
        setBulk({ label, value: Math.round((done / ids.length) * 100) });
        return step(index + 1);
      });
    };
    step(0).then(
      () => {
        setBulk(undefined);
        setSelected(new Set());
        toasts.toast({
          tone: 'success',
          message: kind === 'spam' ? strings.markedSpamMany(done) : strings.releasedMany(done),
        });
        void router.invalidate();
      },
      (error: unknown) => {
        setBulk(undefined);
        // Keep the ones that didn't change picked, and say how far it got.
        setSelected(new Set(ids.slice(done)));
        const reason = isDataError(error) ? error.message : strings.failedText;
        toasts.toast({ tone: 'danger', message: `${strings.settledSome(done, ids.length)} ${reason}` });
        void router.invalidate();
      },
    );
  };

  /** Files these in the CRM the way the form files now, says how many it took, and follows the job to its end. */
  const addToCrm = (ids: readonly string[]) => {
    if (ids.length === 0 || busy !== undefined) return;
    setBusy('add');
    // At most the contract's ADD_TO_CRM_MAX in one call.
    data.submissions.addToCrm(slug, formId, ids.slice(0, ADD_MAX)).then(
      (result) => {
        setBusy(undefined);
        setSelected(new Set());
        toasts.toast(
          result.queued === 0
            ? { tone: 'info', message: strings.nothingToAdd }
            : { tone: 'info', message: strings.addQueued(result.queued, result.skipped) },
        );
        if (result.jobId !== undefined) {
          followJob(result.jobId, (job) => {
            toasts.toast({
              tone: job.status === 'succeeded' ? 'success' : 'danger',
              message:
                job.status === 'succeeded' ? strings.addDone(job.done, job.refused) : strings.jobFailed(job.label),
            });
            void router.invalidate();
          });
        }
        void router.invalidate();
      },
      (error: unknown) => {
        setBusy(undefined);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
      },
    );
  };

  /** Exports the picked rows, or else what the filter shows, as CSV; the file downloads once its job is done. */
  const exportCsv = () => {
    // The picked rows; else what the table shows when a search narrows it; else the filter.
    const ids = (picked.length > 0 ? picked : query.trim() === '' ? [] : shown).map((submission) => submission.id);
    data.submissions
      .export(
        slug,
        data.submissions.newId(),
        formId,
        ids.length > 0
          ? { kind: 'ids', submissionIds: ids.slice(0, EXPORT_MAX) }
          : { kind: 'filter', ...(state === undefined ? {} : { state }) },
      )
      .then(
        (view) => {
          toasts.toast({ tone: 'info', message: strings.exportStarted });
          followJob(view.jobId, (job) => {
            toasts.toast(
              job.status === 'succeeded'
                ? {
                    tone: 'success',
                    message: strings.exportReady(view.fileName),
                    action: {
                      label: strings.download,
                      onAction: () => {
                        // A new tab, so an expired file's error never replaces the app.
                        window.open(view.downloadPath, '_blank', 'noopener');
                      },
                    },
                  }
                : { tone: 'danger', message: strings.jobFailed(job.label) },
            );
          });
        },
        (error: unknown) => {
          toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
        },
      );
  };

  const moreActions = (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={strings.moreSubmissionActions} />
      <Menu
        label={strings.moreSubmissionActions}
        disabledKeys={rows.length === 0 ? ['export'] : []}
        onAction={(key) => {
          if (key === 'export') exportCsv();
          if (key === 'sync') setSyncing(true);
        }}
      >
        <MenuItem
          id="export"
          icon="download"
          description={
            picked.length > 0
              ? strings.exportPicked(picked.length)
              : query.trim() === ''
                ? strings.exportFilter
                : strings.exportShown
          }
        >
          {strings.exportCsv}
        </MenuItem>
        {isFiling && (
          <MenuItem id="sync" icon="refresh-cw" description={strings.syncOldText}>
            {strings.syncOld}
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );

  const toolbar = (
    <LinkListToolbar
      searchLabel={strings.searchSubmissions}
      query={query}
      onQueryChange={setQuery}
      size="sm"
      actions={
        <>
          <Select
            label={strings.filterStates}
            isLabelHidden
            size="sm"
            items={[
              { id: ALL, label: strings.allStates },
              ...FILTERS.map((each) => ({
                id: each,
                label: each === 'processed' && !isFiling ? strings.stateKept : strings.states[each],
              })),
            ]}
            value={state ?? ALL}
            onChange={(value) => {
              go(
                undefined,
                FILTERS.find((each) => each === value),
              );
            }}
          />
          {canManage && moreActions}
        </>
      }
    />
  );

  const cell = (submission: SubmissionSummary, column: string) => {
    switch (column) {
      case 'when':
        return <RelativeTime value={submission.receivedAt} />;
      case 'person': {
        // The record it filed into; else the name it gave, or its email (the State column says if it is in the CRM).
        const crm = submission.crm;
        if (crm.state !== 'linked')
          return <TruncatedText>{nameOf(submission) ?? submission.email ?? ''}</TruncatedText>;
        const href = link(crm.record.objectId, crm.record.recordId);
        return <RecordChip display={crm.record} {...(href === undefined ? {} : { href })} isFlat />;
      }
      case EMAIL_COLUMN:
        return <TruncatedText>{submission.email ?? ''}</TruncatedText>;
      case 'state':
        return <StatusDot hue={stateHue(submission, isFiling)}>{stateLabel(submission, isFiling)}</StatusDot>;
      default: {
        // An answer column: this question's answer, cut to the cell, the whole of it in a tooltip when cut.
        const answer = submission.firstAnswers.find((each) => each.questionId === column);
        return <TruncatedText>{answer === undefined ? '' : answerText(answer)}</TruncatedText>;
      }
    }
  };

  return (
    <>
      {/* The filter and search sit at the end of the tab strip, as Captures' do: no row of their own. */}
      {slot === null ? toolbar : createPortal(toolbar, slot)}
      {state === undefined && waiting > 0 && (
        <Callout
          tone="warning"
          actions={
            <Button
              onPress={() => {
                go(undefined, 'needs_review');
              }}
            >
              {strings.review}
            </Button>
          }
        >
          {strings.needReview(waiting)}
        </Callout>
      )}
      {canManage && picked.length > 0 && (
        <BulkActionBar
          count={picked.length}
          total={shown.length}
          onClear={() => {
            setSelected(new Set());
          }}
          {...(bulk === undefined ? {} : { progress: bulk })}
        >
          {canRelease && (
            <Button
              onPress={() => {
                settleAll('release');
              }}
            >
              {strings.notSpam}
            </Button>
          )}
          {addable.length > 0 && (
            <Button
              isPending={busy === 'add'}
              onPress={() => {
                addToCrm(addable.map((submission) => submission.id));
              }}
            >
              {strings.addToCrm}
            </Button>
          )}
          {canMarkSpam && (
            <Button
              onPress={() => {
                settleAll('spam');
              }}
            >
              {strings.markSpam}
            </Button>
          )}
        </BulkActionBar>
      )}
      <Table
        label={strings.tabSubmissions}
        columns={columns}
        rows={shown}
        getRowId={(submission) => submission.id}
        renderCell={cell}
        isHeaderSticky
        {...(canManage
          ? {
              selected,
              onSelectedChange: setSelected,
              getSelectLabel: (submission: SubmissionSummary) =>
                submission.mainRecord?.name ?? submission.email ?? strings.submission,
            }
          : {})}
        onRowAction={(id) => {
          go(id);
        }}
        emptyState={
          query.trim() !== '' ? (
            <EmptyState icon="search" title={strings.noMatch(query.trim())} />
          ) : state === undefined ? (
            <EmptyState
              icon="inbox"
              title={strings.noSubmissions}
              actions={<CopyButton value={formLink} label={strings.copyLink} variant="primary" />}
            >
              {strings.noSubmissionsText}
            </EmptyState>
          ) : (
            <EmptyState icon="inbox" title={strings.noneIn[state]} />
          )
        }
      />
      {held.next !== undefined && (
        <Button onPress={loadMore} isPending={busy === 'more'}>
          {strings.loadMore}
        </Button>
      )}
      {open !== undefined && (
        <Panel
          title={strings.submission}
          isOpen
          onClose={() => {
            go(undefined);
          }}
          {...(canManage
            ? {
                footer: (
                  <>
                    {open.state === 'spam' && (
                      <Button variant="primary" isPending={busy === 'release'} onPress={() => act('release', open.id)}>
                        {strings.release}
                      </Button>
                    )}
                    {open.crm.state === 'not_in_crm' && open.crm.canAddToCrm && (
                      // Retry is the one primary on a failed enquiry; Add to CRM files it with today's settings.
                      <Button
                        {...(open.state === 'failed' ? {} : { variant: 'primary' as const })}
                        isPending={busy === 'add'}
                        onPress={() => addToCrm([open.id])}
                      >
                        {strings.addToCrm}
                      </Button>
                    )}
                    {open.state === 'failed' && (
                      <Button variant="primary" isPending={busy === 'retry'} onPress={() => act('retry', open.id)}>
                        {strings.retry}
                      </Button>
                    )}
                    {open.state !== 'spam' && (
                      <Button isPending={busy === 'spam'} onPress={() => act('spam', open.id)}>
                        {strings.markSpam}
                      </Button>
                    )}
                    <Button variant="ghost" icon="trash" onPress={() => setConfirmingDelete(true)}>
                      {strings.deleteSubmission}
                    </Button>
                  </>
                ),
              }
            : {})}
        >
          <SubmissionDetail submission={open} link={link} isFiling={isFiling} />
        </Panel>
      )}
      <SyncDialog
        slug={slug}
        formId={formId}
        reason="menu"
        isOpen={isSyncing}
        onClose={() => {
          setSyncing(false);
        }}
        onStarted={(jobId) => {
          setSyncing(false);
          toasts.toast({ tone: 'info', message: strings.syncStarted });
          followJob(jobId, (job) => {
            toasts.toast({
              tone: job.status === 'succeeded' ? 'success' : 'danger',
              message:
                job.status === 'succeeded' ? strings.syncDone(job.done, job.refused) : strings.jobFailed(job.label),
            });
            void router.invalidate();
          });
        }}
      />
      <Modal
        title={strings.deleteSubmissionTitle}
        tone="danger"
        isOpen={isConfirmingDelete}
        onOpenChange={setConfirmingDelete}
        actions={
          <>
            <Button slot="close" isDisabled={busy === 'delete'}>
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              isPending={busy === 'delete'}
              onPress={() => {
                if (open !== undefined) act('delete', open.id);
              }}
            >
              {strings.deleteSubmission}
            </Button>
          </>
        }
      >
        <p>{strings.deleteSubmissionText}</p>
      </Modal>
    </>
  );
}

/** One submission: its answers in question order (Not filed marked), where it came from, and the records it touched. */
function SubmissionDetail({
  submission,
  link,
  isFiling,
}: {
  readonly submission: SubmissionView;
  readonly link: ReturnType<typeof recordLinks>;
  readonly isFiling: boolean;
}) {
  const source = Object.entries(submission.hidden).map(([term, description]) => ({ term, description }));
  return (
    <>
      {submission.failure !== undefined && (
        <Callout tone="danger" title={strings.failure}>
          {submission.failure}
        </Callout>
      )}
      <DescriptionList
        items={[
          { term: strings.state, description: stateLabel(submission, isFiling) },
          { term: strings.when, description: <RelativeTime value={submission.receivedAt} /> },
        ]}
      />
      <h3>{strings.answers}</h3>
      <DescriptionList
        layout="stacked"
        items={submission.answers.map((answer) => ({
          term: answer.attributeId === undefined ? `${answer.label} · ${strings.notFiledMark}` : answer.label,
          description: answerText(answer),
        }))}
      />
      {source.length > 0 && (
        <>
          <h3>{strings.cameFrom}</h3>
          <DescriptionList items={source} />
        </>
      )}
      {submission.records.length > 0 && (
        <>
          <h3>{strings.records}</h3>
          <DescriptionList
            items={submission.records.map((touched) => {
              const href = link(touched.record.objectId, touched.record.recordId);
              return {
                term: strings.recordAction[touched.action],
                description: <RecordChip display={touched.record} {...(href === undefined ? {} : { href })} />,
              };
            })}
          />
        </>
      )}
    </>
  );
}
