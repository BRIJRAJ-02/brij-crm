// Brief
// Purpose: a form's submissions (spec 0023): who sent what and when, newest first, with what needs a look on top.
// Main task: scan the people and their first answers, open one in full, settle many at once (spam or not), and get
// any that aren't in the CRM there (Add to CRM, Sync earlier submissions); take them out as CSV.
// Leaves out: counts per state, server search (search filters the rows loaded so far), and live arrival.
import {
  isDataError,
  type JobView,
  type ObjectSummary,
  type SubmissionPage,
  type SubmissionState,
  type SubmissionSummary,
  type SubmissionView,
} from '@crm/data';
import {
  Menu,
  MenuItem,
  MenuTrigger,
  Avatar,
  BulkActionBar,
  Button,
  Callout,
  CopyButton,
  DescriptionList,
  EmptyState,
  FieldGroup,
  Modal,
  Panel,
  RecordChip,
  RelativeTime,
  LinkListToolbar,
  Separator,
  Select,
  Table,
  TruncatedText,
  type TableColumn,
} from '@crm/ui';
// eslint-disable-next-line no-restricted-imports -- a submission's state, not an attribute value
import { formatDate, StatusDot } from '@crm/ui';
import { useNavigate, useRouter, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { recordLinks } from '../records/timeline.ts';
import { AnswerList, answerText, holdsFile } from '../questions/AnswerList.tsx';
import { answerFiling, notSavedReasons } from './answer-filing.ts';
import { cameFromOf } from './came-from.ts';
import { formHref } from './paths.ts';
import { strings } from './strings.ts';
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
  readonly questions: readonly {
    readonly id: string;
    readonly key: string;
    readonly label: string;
  }[];
  /** The form's public link, for the empty state's Copy link. */
  readonly link: string;
  /** The form's name, under a submission's sender in its panel. */
  readonly formName: string;
  /** Follows a job this tab started to its end; the editor holds it, so a tab change never loses the result. */
  readonly followJob: (jobId: string, onDone: (job: JobView) => void) => void;
  /** The live form adds submissions to the CRM; one that keeps them only offers no Add to CRM or sync. */
  readonly isFiling: boolean;
  /** Whether the form has any submission at all, spam included; without one the tab shows only its empty state. */
  readonly hasSubmissions: boolean;
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
  formName,
  followJob,
  isFiling,
  hasSubmissions,
}: SubmissionsTabProps) {
  const slot = useFormToolbarSlot();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<{ readonly label: string; readonly value: number } | undefined>(undefined);
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
  // A refused delete says why inside its confirm, which stays open (the owner's rule, 21 October 2026).
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined);
  // Adding many at once asks first (the confirms rule, 21 October 2026); one from the panel stays one click.
  // The picked ids stay while the dialog plays its exit, so its title keeps its count.
  const [addingMany, setAddingMany] = useState<readonly string[]>([]);
  const [isAddingMany, setIsAddingMany] = useState(false);
  const [addFailure, setAddFailure] = useState<string | undefined>(undefined);

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

  /**
   * Not spam and Mark as spam by the row's own state: a submission the bot
   * checks held in Needs review is settled with `resolve` (the server refuses
   * `release` for it, and `markSpam` would lose who settled it), a spam one
   * with `release`.
   */
  const settleOne = (submissionId: string, kind: 'release' | 'spam') => {
    const held = rows.find((submission) => submission.id === submissionId)?.state === 'needs_review';
    if (held) return data.submissions.resolve(slug, submissionId, kind === 'release' ? 'not_spam' : 'spam');
    return kind === 'release'
      ? data.submissions.release(slug, submissionId)
      : data.submissions.markSpam(slug, submissionId);
  };

  const act = (kind: 'release' | 'spam' | 'retry' | 'delete', submissionId: string) => {
    if (busy !== undefined) return;
    setBusy(kind);
    if (kind === 'delete') setDeleteFailure(undefined);
    const done =
      kind === 'release' || kind === 'spam'
        ? settleOne(submissionId, kind)
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
        const message = isDataError(error) ? error.message : strings.failedText;
        if (kind === 'delete') setDeleteFailure(message);
        else toasts.toast({ tone: 'danger', message });
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
  // Who sent the open submission: their record's name, the name they gave, or their email.
  const sender = open === undefined ? undefined : (open.mainRecord?.name ?? nameOf(open) ?? open.email);
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
    // When and State lead after the person, so a long email or answer scrolling the table sideways never hides them.
    { id: 'when', label: strings.when },
    { id: 'state', label: strings.state },
    ...(hasEmailColumn ? [{ id: EMAIL_COLUMN, label: strings.email }] : []),
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
      const call = settleOne(id, kind);
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
    setAddFailure(undefined);
    data.submissions.addToCrm(slug, formId, ids.slice(0, ADD_MAX)).then(
      (result) => {
        setBusy(undefined);
        setIsAddingMany(false);
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
        const reason = isDataError(error) ? error.message : strings.failedText;
        // The many confirm stays open and says why; one from the panel says it in a toast.
        if (ids.length > 1) setAddFailure(reason);
        else toasts.toast({ tone: 'danger', message: reason });
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

  // One clear action for the rows: Export, only when there are rows. Form wide actions live in the top bar's menu.
  const exportButton = (
    <Button icon="download" label={strings.exportButton} isLabelCollapsible onPress={exportCsv}>
      {strings.exportButton}
    </Button>
  );

  const isEmpty = !hasSubmissions && rows.length === 0 && state === undefined && query.trim() === '';

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
          {canManage && rows.length > 0 && exportButton}
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
      {/* Before the first submission there is nothing to search, filter or export: only the empty state shows. */}
      {isEmpty ? null : slot === null ? toolbar : createPortal(toolbar, slot)}
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
                const ids = addable.map((submission) => submission.id);
                if (ids.length === 1) addToCrm(ids);
                else {
                  setAddFailure(undefined);
                  setAddingMany(ids);
                  setIsAddingMany(true);
                }
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
      {isEmpty ? (
        <EmptyState
          icon="inbox"
          title={strings.noSubmissions}
          actions={<CopyButton value={formLink} label={strings.copyLink} variant="primary" />}
        >
          {strings.noSubmissionsText}
        </EmptyState>
      ) : (
        <Table
          label={strings.tabSubmissions}
          columns={columns}
          rows={shown}
          getRowId={(submission) => submission.id}
          renderCell={cell}
          // A long email or answer widens the table: it scrolls sideways in its own frame (its far end fading), as
          // Tally's and Typeform's response tables do, rather than pushing When and State off the page.
          isScrollable
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
      )}
      {held.next !== undefined && (
        <Button onPress={loadMore} isPending={busy === 'more'}>
          {strings.loadMore}
        </Button>
      )}
      {open !== undefined && (
        <Panel
          title={sender ?? strings.submission}
          {...(sender === undefined ? {} : { leading: <Avatar name={sender} isDecorative /> })}
          subtitle={
            <>
              {formName} · <RelativeTime value={open.receivedAt} />
            </>
          }
          actions={<StatusDot hue={stateHue(open, isFiling)}>{stateLabel(open, isFiling)}</StatusDot>}
          isStacked
          isOpen
          onClose={() => {
            go(undefined);
          }}
          {...(canManage
            ? {
                // Delete keeps the footer's start, away from the main action; a failed one keeps Retry in view and
                // folds its other choices into More, so the footer never holds four buttons on a phone.
                footerStart: (
                  <Button variant="danger" icon="trash" onPress={() => setConfirmingDelete(true)}>
                    {strings.deleteSubmission}
                  </Button>
                ),
                footer: (
                  <>
                    {(open.state === 'spam' || open.state === 'needs_review') && (
                      <Button variant="primary" isPending={busy === 'release'} onPress={() => act('release', open.id)}>
                        {strings.release}
                      </Button>
                    )}
                    {open.state === 'failed' ? (
                      <>
                        <MenuTrigger>
                          <Button icon="ellipsis" label={strings.moreActions} />
                          <Menu
                            label={strings.moreActions}
                            onAction={(key) => {
                              if (key === 'add') addToCrm([open.id]);
                              if (key === 'spam') act('spam', open.id);
                            }}
                          >
                            {open.crm.state === 'not_in_crm' && open.crm.canAddToCrm ? (
                              <MenuItem id="add">{strings.addToCrm}</MenuItem>
                            ) : null}
                            <MenuItem id="spam">{strings.markSpam}</MenuItem>
                          </Menu>
                        </MenuTrigger>
                        <Button variant="primary" isPending={busy === 'retry'} onPress={() => act('retry', open.id)}>
                          {strings.retry}
                        </Button>
                      </>
                    ) : (
                      <>
                        {open.state !== 'spam' && (
                          <Button isPending={busy === 'spam'} onPress={() => act('spam', open.id)}>
                            {strings.markSpam}
                          </Button>
                        )}
                        {open.crm.state === 'not_in_crm' && open.crm.canAddToCrm && (
                          <Button variant="primary" isPending={busy === 'add'} onPress={() => addToCrm([open.id])}>
                            {strings.addToCrm}
                          </Button>
                        )}
                      </>
                    )}
                  </>
                ),
              }
            : {})}
        >
          <SubmissionDetail submission={open} link={link} isFiling={isFiling} />
        </Panel>
      )}
      <Modal
        title={strings.deleteSubmissionTitle(
          open === undefined ? undefined : (open.mainRecord?.name ?? nameOf(open) ?? open.email),
        )}
        variant="confirm"
        tone="danger"
        isOpen={isConfirmingDelete}
        isBusy={busy === 'delete'}
        onOpenChange={(isOpen) => {
          if (busy === 'delete') return;
          setConfirmingDelete(isOpen);
          if (!isOpen) setDeleteFailure(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={busy === 'delete'}>
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              icon="trash"
              isPending={busy === 'delete'}
              onPress={() => {
                if (open !== undefined) act('delete', open.id);
              }}
            >
              {strings.deleteSubmissionAction}
            </Button>
          </>
        }
      >
        {deleteFailure !== undefined && <Callout tone="danger">{deleteFailure}</Callout>}
        <p>{strings.deleteSubmissionText}</p>
      </Modal>
      <Modal
        title={strings.addManyTitle(addingMany.length, ADD_MAX)}
        isOpen={isAddingMany}
        isBusy={busy === 'add'}
        onOpenChange={(isOpen) => {
          if (busy === 'add' || isOpen) return;
          setIsAddingMany(false);
          setAddFailure(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={busy === 'add'}>
              {strings.cancel}
            </Button>
            <Button
              variant="primary"
              icon="plus"
              isPending={busy === 'add'}
              onPress={() => {
                addToCrm(addingMany);
              }}
            >
              {strings.addToCrm}
            </Button>
          </>
        }
      >
        {addFailure !== undefined && <Callout tone="danger">{addFailure}</Callout>}
        <p>{strings.addManyText(addingMany.length, ADD_MAX)}</p>
      </Modal>
    </>
  );
}

/**
 * One submission, every row stacked the same way: what went wrong when it did, its answers in question order
 * (filing said once for the section, the exceptions marked), the records it touched, and where it came from.
 */
function SubmissionDetail({
  submission,
  link,
  isFiling,
}: {
  readonly submission: SubmissionView;
  readonly link: ReturnType<typeof recordLinks>;
  readonly isFiling: boolean;
}) {
  const source = cameFromOf(submission);
  const filing = answerFiling(submission.answers, submission.crm, isFiling, submission.refused);
  const reasons = submission.crm.state === 'linked' ? notSavedReasons(submission.answers, submission.refused) : [];
  return (
    <>
      {submission.failure !== undefined && (
        <Callout tone="danger" title={strings.failure}>
          {submission.failure}
        </Callout>
      )}
      {submission.filesRemovedOn !== undefined && submission.answers.some(holdsFile) && (
        // Its files are kept so a real one can be released with them (late trap #52), but a bot may have sent them.
        <Callout tone="warning" title={strings.spamFilesTitle}>
          {strings.spamFiles(formatDate(submission.filesRemovedOn, navigator.languages[0] ?? 'en-GB'))}
        </Callout>
      )}
      {reasons.length > 0 && (
        // What filing left off the record, and why: the answers stay here, so nothing is lost, but the record lacks them.
        <Callout tone="warning" title={strings.notSavedTitle(submission.refused.length)}>
          <DescriptionList
            layout="stacked"
            items={reasons.map((reason) => ({
              id: reason.message,
              term: strings.questionList(reason.labels),
              description: reason.message,
            }))}
          />
          <p>{strings.notSavedNext}</p>
        </Callout>
      )}
      <FieldGroup
        label={strings.answers}
        tone="heading"
        headingLevel={3}
        {...(filing.note === undefined ? {} : { meta: filing.note })}
      >
        <AnswerList
          answers={submission.answers}
          markOf={(answer) => (filing.marked.has(answer.questionId) ? filing.mark : undefined)}
        />
      </FieldGroup>
      {(submission.records.length > 0 || submission.crm.state === 'filing') && (
        <>
          <Separator />
          <FieldGroup
            label={strings.records}
            tone="heading"
            headingLevel={3}
            isLive
            {...(submission.records.length > 0 ? {} : { hint: strings.answersFiling })}
          >
            {submission.records.length > 0 ? (
              <DescriptionList
                layout="stacked"
                items={submission.records.map((touched) => {
                  const href = link(touched.record.objectId, touched.record.recordId);
                  return {
                    id: `${touched.record.recordId}:${touched.action}`,
                    term: strings.recordAction[touched.action],
                    description: <RecordChip display={touched.record} {...(href === undefined ? {} : { href })} />,
                  };
                })}
              />
            ) : null}
          </FieldGroup>
        </>
      )}
      {source.length > 0 && (
        <>
          <Separator />
          <FieldGroup label={strings.cameFrom} tone="heading" headingLevel={3}>
            {/* Plain text, never links: a page's address came from the visitor's browser. */}
            <DescriptionList layout="stacked" items={[...source]} />
          </FieldGroup>
        </>
      )}
    </>
  );
}
