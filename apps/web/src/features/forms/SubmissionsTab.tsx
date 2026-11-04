// Brief
// Purpose: a form's submissions (spec 0023): who sent what and when, newest first, with what needs a look on top.
// Main task: scan the people and their first answers, open one in full, settle or delete many at once, and get
// any that aren't in the CRM there (Add to CRM, Sync earlier submissions); take them out as CSV.
// Leaves out: counts per state, server search (search filters the rows loaded so far), and live arrival.
import {
  isDataError,
  type JobView,
  type ObjectSummary,
  type SubmissionPage,
  type SubmissionSelection,
  type SubmissionState,
  type SubmissionSummary,
  type SubmissionView,
} from '@crm/data';
import {
  AppShellContext,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Avatar,
  Badge,
  BulkActionBar,
  focusLater,
  Button,
  ButtonLink,
  Callout,
  CopyButton,
  DescriptionList,
  EmptyState,
  FieldGroup,
  Modal,
  Panel,
  PreviewFooter,
  RecordChip,
  RelativeTime,
  LinkListToolbar,
  Separator,
  Select,
  ShortcutTooltip,
  Table,
  TruncatedText,
  type TableColumn,
} from '@crm/ui';
import { DELETE_SUBMISSIONS_MAX } from '@crm/data/forms';
// eslint-disable-next-line no-restricted-imports -- a submission's state, not an attribute value
import { formatDate, StatusDot } from '@crm/ui';
import { useNavigate, useRouter, useRouteContext } from '@tanstack/react-router';
import { useContext, useEffect, useState } from 'react';
import { pageHeading } from '../navigation/focus.ts';
import { recordLinks } from '../records/timeline.ts';
import { AnswerList, answerText, holdsFile, PhoneAnswer } from '../questions/AnswerList.tsx';
import { answerFiling, notSavedReasons } from './answer-filing.ts';
import { cameFromOf } from './came-from.ts';
import { spamReason } from './spam-reason.ts';
import { markSeen } from './seen.ts';
import { formHref } from './paths.ts';
import { strings } from './strings.ts';

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
  /** Spam waiting in the form: All leaves it out, and a chip opens the Spam filter (forms fix a8). */
  readonly spamCount?: number;
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
  spamCount = 0,
}: SubmissionsTabProps) {
  // Opening the answers clears the form's New on the list, for this reader in this browser (forms critique c).
  useEffect(() => {
    markSeen(slug, formId);
  }, [slug, formId, page]);
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
  // Deleted here and not yet confirmed or brought back (forms fixes 3): hidden at once, shown again on a refusal or
  // an Undo.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const rows = [...page.items, ...held.items].filter((submission) => !gone.has(submission.id));
  const hide = (ids: readonly string[]) => {
    setGone((before) => new Set([...before, ...ids]));
  };
  const unhide = (ids: readonly string[]) => {
    setGone((before) => new Set([...before].filter((id) => !ids.includes(id))));
  };
  const [busy, setBusy] = useState<string | undefined>(undefined);
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
        // A delete is one click with Undo (forms fixes 2): deletes are soft, so it comes back as it was.
        toasts.toast({
          tone: 'success',
          message: said[kind],
          ...(kind === 'delete'
            ? {
                action: {
                  label: strings.undo,
                  onAction: () => {
                    undoDelete([submissionId], true);
                  },
                },
              }
            : {}),
        });
        if (kind === 'delete') go(undefined);
        else void router.invalidate();
      },
      (error: unknown) => {
        setBusy(undefined);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
      },
    );
  };

  // Use new (forms fix a4): one kept answer written over the record's value, the panel read again after.
  const [usingNew, setUsingNew] = useState<string | undefined>(undefined);
  const applyNew = (submissionId: string, questionId: string) => {
    if (usingNew !== undefined) return;
    setUsingNew(questionId);
    data.submissions.useNewAnswer(slug, submissionId, questionId).then(
      () => {
        setUsingNew(undefined);
        // Undo puts the record's value before back, and the answer reads as kept again (forms fixes 2).
        toasts.toast({
          tone: 'success',
          message: strings.usedNew,
          action: {
            label: strings.undo,
            onAction: () => {
              data.submissions.undoUseNewAnswer(slug, submissionId, questionId).then(
                () => {
                  void router.invalidate();
                },
                (error: unknown) => {
                  toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
                },
              );
            },
          },
        });
        void router.invalidate();
      },
      (error: unknown) => {
        setUsingNew(undefined);
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
  // Who sent the open submission: their record's name, the name they gave, or their email.
  const sender = open === undefined ? undefined : (open.mainRecord?.name ?? nameOf(open) ?? open.email);
  const { isCompact } = useContext(AppShellContext);
  // The record the open submission made or found, when the reader can open it: the panel's primary.
  const openHref = open?.crm.state === 'linked' ? link(open.crm.record.objectId, open.crm.record.recordId) : undefined;
  // What the state asks of the open submission (Release, Retry, Add to CRM, Save answers to the CRM) is the footer's
  // one primary; Open the person is then a secondary beside it.
  const hasStateAction =
    open !== undefined &&
    (open.state === 'spam' ||
      open.state === 'needs_review' ||
      open.state === 'failed' ||
      (open.crm.state === 'not_in_crm' && open.crm.canAddToCrm) ||
      (!isFiling && open.state === 'processed'));
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
  // The open submission's neighbours in the list as shown, for the panel's arrows and J and K.
  const at = open === undefined ? -1 : shown.findIndex((submission) => submission.id === open.id);
  const before = at > 0 ? shown[at - 1] : undefined;
  const after = at >= 0 ? shown[at + 1] : undefined;
  useEffect(() => {
    // Never under a dialog: J would change the submission an open Delete acts on.
    if (open === undefined || isAddingMany) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const next = key === 'j' ? after : key === 'k' ? before : undefined;
      if (next === undefined) return;
      event.preventDefault();
      go(next.id);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  });

  const waiting = rows.filter((submission) => submission.state === 'needs_review').length;
  // What a bulk action acts on: the picked rows still in view (a filter or a search may hide some).
  const picked = shown.filter((submission) => selected.has(submission.id));
  // The bulk bar stays mounted while it sinks out after the selection clears, so its exit plays (BulkActionBar's
  // isOpen and onLeft).
  const [isBarShown, setBarShown] = useState(false);
  if ((picked.length > 0 || bulk !== undefined) && !isBarShown) setBarShown(true);
  const canRelease = picked.some((submission) => submission.state === 'spam' || submission.state === 'needs_review');
  const canMarkSpam = picked.some((submission) => submission.state !== 'spam');
  const addable = picked.filter((submission) => submission.crm.state === 'not_in_crm' && submission.crm.canAddToCrm);
  const hasEmailColumn = nameQuestion !== undefined && shown.some((submission) => submission.email !== undefined);
  const columns: readonly TableColumn[] = [
    // On a phone each row is two lines (forms fixes 2): the person, then when and its state; the rest open with it.
    // Every column is as wide as its content, as People's are, and the last takes what is left, so the values sit
    // side by side from the start edge (the owner, 5 November 2026: even columns made Person huge and the values
    // float apart).
    { id: 'person', label: strings.person, isRowHeader: true, isInline: true, phone: 'title', size: 'fit' },
    // When and State lead after the person, so a long email or answer scrolling the table sideways never hides them.
    { id: 'when', label: strings.when, size: 'fit' },
    { id: 'state', label: strings.state, size: 'fit' },
    ...(hasEmailColumn
      ? [{ id: EMAIL_COLUMN, label: strings.email, phone: 'hidden' as const, size: 'fit' as const }]
      : []),
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
      .map((question) => ({ id: question.id, label: question.label, phone: 'hidden' as const, size: 'fit' as const })),
  ];
  const sized: readonly TableColumn[] = columns.map((column, index) =>
    index === columns.length - 1 ? { ...column, size: 'fill' } : column,
  );

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

  /** Undo: puts deleted submissions back, and reopens the one that was open. */
  const undoDelete = (ids: readonly string[], reopen: boolean) => {
    void Promise.allSettled(ids.map((id) => data.submissions.restore(slug, id))).then((results) => {
      const back = results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.find((result) => result.status === 'rejected');
      if (failed === undefined) {
        toasts.toast({ tone: 'success', message: strings.restoredMany(back) });
        const [only] = ids;
        if (reopen && only !== undefined) {
          go(only);
          return;
        }
      } else {
        // Some came back, some didn't: said as such, with the first reason.
        const reason = isDataError(failed.reason) ? failed.reason.message : strings.failedText;
        toasts.toast({
          tone: 'danger',
          message: back === 0 ? reason : `${strings.restoredSome(back, ids.length)} ${reason}`,
        });
      }
      void router.invalidate();
    });
  };

  /**
   * Undo of a bulk delete (forms fixes 3): one request. The rows come back at once and go again if the request is
   * refused.
   */
  const undoDeleteMany = (ids: readonly string[]) => {
    unhide(ids);
    data.submissions.restoreMany(slug, formId, ids).then(
      (result) => {
        toasts.toast({ tone: 'success', message: strings.restoredMany(result.restoredIds.length) });
        void router.invalidate();
      },
      (error: unknown) => {
        hide(ids);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
      },
    );
  };

  /**
   * Deletes the picked submissions in one request (forms fixes 3), at once on screen: the rows go as it is pressed,
   * then the toast offers Undo for every one deleted (deletes are soft, so it asks nothing first). A refusal brings
   * them back, still picked; one still being added to the CRM stays, and the toast says so.
   */
  const deleteAll = (ids: readonly string[]) => {
    if (bulk !== undefined) return;
    // Over what one request takes: said at once, nothing hidden first (review, forms fixes 3).
    if (ids.length > DELETE_SUBMISSIONS_MAX) {
      toasts.toast({ tone: 'danger', message: strings.deleteTooMany(DELETE_SUBMISSIONS_MAX) });
      return;
    }
    hide(ids);
    setSelected(new Set());
    // The bar that held Delete goes with the selection, so focus goes to the page's heading, not the body.
    focusLater(() => pageHeading(document));
    // The open one may be among them: the panel closes with it, and opens again if the delete is refused.
    const closedId = open !== undefined && ids.includes(open.id) ? open.id : undefined;
    if (closedId !== undefined) go(undefined);
    data.submissions.deleteMany(slug, formId, ids).then(
      (result) => {
        const deleted = result.deletedIds;
        const kept = ids.filter((id) => !deleted.includes(id));
        if (kept.length > 0) unhide(kept);
        const why = [
          ...(result.stillFiling > 0 ? [strings.stillFilingKept(result.stillFiling)] : []),
          ...(result.skipped > 0 ? [strings.deleteSkipped(result.skipped)] : []),
        ];
        toasts.toast({
          tone: kept.length > 0 ? 'info' : 'success',
          message: [strings.deletedMany(deleted.length), ...why].join(' '),
          ...(deleted.length === 0
            ? {}
            : {
                action: {
                  label: strings.undo,
                  onAction: () => {
                    undoDeleteMany(deleted);
                  },
                },
              }),
        });
        // Once the page reads again they are gone from it anyway, so they leave the hidden set (one restored
        // elsewhere later shows again). With the panel closed, its own navigation already read the page.
        const reread = closedId === undefined ? router.invalidate() : Promise.resolve();
        void reread.then(() => {
          unhide(deleted);
        });
      },
      (error: unknown) => {
        // Nothing was deleted: the rows come back, still picked, and the open one opens again.
        unhide(ids);
        setSelected(new Set(ids));
        if (closedId !== undefined) go(closedId);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
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

  /**
   * Exports the picked rows, or else what the filter shows, as CSV (forms fix a7): one toast that says it is being
   * prepared, then turns into Download, which saves the file in place rather than opening a tab.
   */
  const exportCsv = () => {
    // The picked rows; else what the table shows when a search narrows it; else the filter.
    const ids = (picked.length > 0 ? picked : query.trim() === '' ? [] : shown).map((submission) => submission.id);
    const select: SubmissionSelection =
      ids.length > 0
        ? { kind: 'ids', submissionIds: ids.slice(0, EXPORT_MAX) }
        : { kind: 'filter', ...(state === undefined ? {} : { state }) };
    const preparing = toasts.toast({ tone: 'info', message: strings.exportStarted, isBusy: true });
    // A small export downloads at once (forms fixes 2); a large one is made as a job and offers Download when done.
    data.submissions.exportNow(slug, formId, select).then(
      (file) => {
        toasts.dismiss(preparing);
        saveText(file.csv, file.fileName);
        toasts.toast({ tone: 'success', message: strings.exportSaved(file.fileName) });
      },
      (error: unknown) => {
        if (!isDataError(error) || error.code !== 'JOB_TOO_LARGE') {
          toasts.dismiss(preparing);
          toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
          return;
        }
        exportAsJob(select, preparing);
      },
    );
  };

  /** A large export, made as a job: the toast turns into Download when it is done. */
  const exportAsJob = (select: SubmissionSelection, preparing: string) => {
    data.submissions.export(slug, data.submissions.newId(), formId, select).then(
      (view) => {
        followJob(view.jobId, (job) => {
          toasts.dismiss(preparing);
          toasts.toast(
            job.status === 'succeeded'
              ? {
                  tone: 'success',
                  message: strings.exportReady(view.fileName),
                  action: {
                    label: strings.download,
                    onAction: () => {
                      downloadFile(view.downloadPath, view.fileName);
                    },
                  },
                }
              : { tone: 'danger', message: strings.jobFailed(job.label) },
          );
        });
      },
      (error: unknown) => {
        toasts.dismiss(preparing);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
      },
    );
  };

  // One clear action for the rows: Export, only when there are rows, naming the picked ones when some are.
  const exportLabel = picked.length > 0 ? strings.exportSelected(picked.length) : strings.exportButton;
  const exportButton = (
    <Button icon="download" label={exportLabel} isLabelCollapsible onPress={exportCsv}>
      {exportLabel}
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
          {/* All leaves spam out (forms fix a8): one quiet way to it, counted. */}
          {state === undefined && spamCount > 0 && (
            <Button
              icon="circle-alert"
              onPress={() => {
                go(undefined, 'spam');
              }}
            >
              {strings.spamChip(spamCount)}
            </Button>
          )}
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
        // One click target per row (forms fix a10): the chip shows who, never links away; the row opens the panel,
        // which links to the record. "Returning" when it went to a record that was already there (forms fix a4).
        const crm = submission.crm;
        const returning = submission.isReturning === true ? <Badge text={strings.returning} isWhole /> : null;
        if (crm.state !== 'linked') {
          return (
            <>
              <TruncatedText>{nameOf(submission) ?? submission.email ?? ''}</TruncatedText>
              {returning}
            </>
          );
        }
        return (
          <>
            <RecordChip display={crm.record} isFlat />
            {returning}
          </>
        );
      }
      case EMAIL_COLUMN:
        // Plain text, never the email's link chip: a row has one click target, which opens it (forms fix a10).
        return <TruncatedText>{submission.email ?? ''}</TruncatedText>;
      case 'state':
        return <StatusDot hue={stateHue(submission, isFiling)}>{stateLabel(submission, isFiling)}</StatusDot>;
      default: {
        // An answer column: this question's answer, cut to the cell, the whole of it in a tooltip when cut.
        const answer = submission.firstAnswers.find((each) => each.questionId === column);
        // A phone reads as the panel shows it, spaced with its flag (forms critique a).
        if (answer?.answerType === 'phone')
          return <PhoneAnswer answer={answer} text={answerText(answer)} surface="card" />;
        return <TruncatedText>{answer === undefined ? '' : answerText(answer)}</TruncatedText>;
      }
    }
  };

  return (
    <>
      {/* The search, filter and Export sit in a row of their own under the tabs, where People and Companies keep
          theirs, at the controls' one height (the owner, 5 November 2026). Before the first submission there is
          nothing to search, filter or export: only the empty state shows. */}
      {isEmpty ? null : toolbar}
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
          columns={sized}
          rows={shown}
          getRowId={(submission) => submission.id}
          renderCell={cell}
          // A long email or answer widens the table: it scrolls sideways in its own frame (its far end fading), as
          // Tally's and Typeform's response tables do, rather than pushing When and State off the page.
          isScrollable
          phoneLayout="rows"
          // The rows run out to the tab's edges, the checkbox on the tabs' line, with the count under them as the
          // records grid's footer says it; Load more sits beside the count while there are more.
          edge="page"
          footer={
            <>
              {held.next === undefined ? strings.submissionCount(shown.length) : strings.submissionsShown(shown.length)}
              {held.next !== undefined && (
                <Button variant="ghost" onPress={loadMore} isPending={busy === 'more'}>
                  {strings.loadMore}
                </Button>
              )}
            </>
          }
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
      {/* At the view's foot, centred, as the records grid, lists and trash float theirs (the owner, 5 November 2026:
          "this popup should be on the bottom"): last in the body, so on a short list it sits at the view's bottom and
          on a long one it sticks there and, scrolled to the end, follows the last row rather than covering it. It
          stays mounted while it sinks out, until onLeft. */}
      {canManage && isBarShown && (
        <PreviewFooter>
          <BulkActionBar
            placement="footer"
            isOpen={picked.length > 0 || bulk !== undefined}
            onLeft={() => {
              setBarShown(false);
            }}
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
            <Button
              variant="danger"
              icon="trash"
              onPress={() => {
                deleteAll(picked.map((submission) => submission.id));
              }}
            >
              {strings.deleteSubmission}
            </Button>
          </BulkActionBar>
        </PreviewFooter>
      )}
      {open !== undefined && (
        <Panel
          title={sender ?? strings.submission}
          // On a phone the panel is the whole screen: its close is Back, at the head's start, where a phone looks for
          // the way out (lane 3c), and the avatar gives it the room.
          {...(isCompact
            ? { closeAs: 'back' as const, backLabel: strings.backToSubmissions }
            : sender === undefined
              ? {}
              : { leading: <Avatar name={sender} isDecorative /> })}
          // The exact moment it came, not "4 hours ago" (lane 3c): the list says how long ago.
          subtitle={
            <>
              {formName} · <RelativeTime value={open.receivedAt} variant="moment" />
            </>
          }
          // The table, its search and the editor's header narrow beside it rather than sliding under it (lane 3c).
          pushesPage
          actions={
            <>
              <StatusDot hue={stateHue(open, isFiling)}>{stateLabel(open, isFiling)}</StatusDot>
              {/* The one before and after in the list, without closing (forms fix a, Gmail's and Attio's K and J). */}
              <ShortcutTooltip content={strings.previousSubmission} kbd="K">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="chevron-up"
                  label={strings.previousSubmission}
                  isDisabled={before === undefined}
                  onPress={() => {
                    if (before !== undefined) go(before.id);
                  }}
                />
              </ShortcutTooltip>
              <ShortcutTooltip content={strings.nextSubmission} kbd="J">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="chevron-down"
                  label={strings.nextSubmission}
                  isDisabled={after === undefined}
                  onPress={() => {
                    if (after !== undefined) go(after.id);
                  }}
                />
              </ShortcutTooltip>
            </>
          }
          isStacked
          isOpen
          onClose={() => {
            go(undefined);
          }}
          {...(canManage
            ? {
                // One ⋯ at the footer's start holds Delete (with its Undo) and, on a failed one, its other choices,
                // so the footer's end carries one primary: Open the person, or what the state asks (lane 3c).
                footerStart: (
                  <MenuTrigger>
                    <Button icon="ellipsis" label={strings.moreActions} isPending={busy === 'delete'} />
                    <Menu
                      label={strings.moreActions}
                      onAction={(key) => {
                        if (key === 'add') addToCrm([open.id]);
                        if (key === 'spam') act('spam', open.id);
                        if (key === 'delete') act('delete', open.id);
                      }}
                    >
                      {open.state === 'failed' && open.crm.state === 'not_in_crm' && open.crm.canAddToCrm ? (
                        <MenuItem id="add">{strings.addToCrm}</MenuItem>
                      ) : null}
                      {open.state === 'failed' ? <MenuItem id="spam">{strings.markSpam}</MenuItem> : null}
                      {open.state === 'failed' ? <MenuSeparator /> : null}
                      <MenuItem id="delete" icon="trash" isDanger>
                        {strings.deleteSubmission}
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                ),
                footer: (
                  <>
                    {(open.state === 'spam' || open.state === 'needs_review') && (
                      <Button variant="primary" isPending={busy === 'release'} onPress={() => act('release', open.id)}>
                        {strings.release}
                      </Button>
                    )}
                    {open.state === 'failed' ? (
                      <Button variant="primary" isPending={busy === 'retry'} onPress={() => act('retry', open.id)}>
                        {strings.retry}
                      </Button>
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
                        {/* A form that keeps answers only had no way to the CRM from here (forms fix a10): the one
                            way is to turn saving on, where it is set; Sync then adds the earlier ones. */}
                        {!isFiling && open.state === 'processed' && (
                          <ButtonLink variant="primary" href={formHref(slug, formId, 'settings')}>
                            {strings.turnOnCrm}
                          </ButtonLink>
                        )}
                        {/* The person it made or found, one press away: the panel's primary (lane 3c, Attio's peek). */}
                        {openHref !== undefined && open.crm.state === 'linked' && (
                          <ButtonLink variant={hasStateAction ? 'secondary' : 'primary'} href={openHref}>
                            {strings.openRecord(open.crm.record.name)}
                          </ButtonLink>
                        )}
                      </>
                    )}
                  </>
                ),
              }
            : {})}
        >
          <SubmissionDetail
            submission={open}
            link={link}
            isFiling={isFiling}
            {...(canManage
              ? {
                  onUseNew: (questionId: string) => {
                    applyNew(open.id, questionId);
                  },
                }
              : {})}
            {...(usingNew === undefined ? {} : { usingNew })}
          />
        </Panel>
      )}
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
  onUseNew,
  usingNew,
}: {
  readonly submission: SubmissionView;
  readonly link: ReturnType<typeof recordLinks>;
  readonly isFiling: boolean;
  /** Use new (forms fix a4): writes a kept answer over the record's value; absent for a reader who only views. */
  readonly onUseNew?: (questionId: string) => void;
  /** The kept answer being written now. */
  readonly usingNew?: string;
}) {
  // Why a submission sits in Spam or Needs review, in one line (forms fix a8).
  const why =
    submission.state === 'spam' || submission.state === 'needs_review'
      ? spamReason(submission.signals, submission.state)
      : undefined;
  const keptAnswers = submission.kept.flatMap((each) => {
    const answer = submission.answers.find((one) => one.questionId === each.questionId);
    return answer === undefined ? [] : [answer];
  });
  const source = cameFromOf(submission);
  // Every question comes, the skipped ones as "No answer" (lane 3c); filing is said over those answered.
  const answered = submission.answers.filter((answer) => answerText(answer) !== '');
  // A company answer reads as the company it was saved on, through the field set's chip (lane 3c).
  const company = submission.records.find((touched) => touched.role === 'company');
  const companyHref = company === undefined ? undefined : link(company.record.objectId, company.record.recordId);
  // A kept answer isn't on the record (forms fix a4): it counts as not saved until Use new writes it.
  const filing = answerFiling(answered, submission.crm, isFiling, [
    ...submission.refused,
    ...submission.kept.map((each) => ({ questionId: each.questionId })),
  ]);
  const reasons = submission.crm.state === 'linked' ? notSavedReasons(submission.answers, submission.refused) : [];
  return (
    <>
      {submission.failure !== undefined && (
        <Callout tone="danger" title={strings.failure}>
          {submission.failure}
        </Callout>
      )}
      {why !== undefined && <Callout tone="info">{why}</Callout>}
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
      {keptAnswers.length > 0 && submission.mainRecord !== undefined && (
        // A returning person's new answers that filing left as they were (their question fills only an empty value):
        // said, never dropped in silence, with Use new beside each (forms fix a4).
        <Callout tone="info" title={strings.keptTitle(keptAnswers.length, submission.mainRecord.name)}>
          <DescriptionList
            layout="stacked"
            items={keptAnswers.map((answer) => ({
              id: answer.questionId,
              term: answer.label,
              // The new answer itself, then Use new: what would be written is always in view.
              description: (
                <>
                  {answer.answerType === 'phone' ? (
                    <PhoneAnswer answer={answer} text={answerText(answer)} surface="panel" />
                  ) : (
                    answerText(answer)
                  )}{' '}
                  {onUseNew !== undefined && (
                    <Button
                      size="sm"
                      isPending={usingNew === answer.questionId}
                      label={strings.useNewLabel(answer.label)}
                      onPress={() => {
                        onUseNew(answer.questionId);
                      }}
                    >
                      {strings.useNew}
                    </Button>
                  )}
                </>
              ),
            }))}
          />
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
          markOf={(answer) =>
            filing.marked.has(answer.questionId) && answerText(answer) !== '' ? filing.mark : undefined
          }
          {...(company === undefined
            ? {}
            : {
                displayOf: (answer: SubmissionView['answers'][number]) =>
                  answer.key === 'company' && answerText(answer) !== '' ? (
                    <RecordChip
                      display={company.record}
                      {...(companyHref === undefined ? {} : { href: companyHref })}
                    />
                  ) : undefined,
              })}
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

/**
 * Saves a file the server sends as an attachment, in place (forms fix a7): an anchor with `download`, so the page
 * stays and no tab opens. An expired file's error comes back as the browser's own failed download.
 */
/** Saves text made in the page as a file, in place (a small export, forms fixes 2). */
function saveText(text: string, fileName: string): void {
  const href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  downloadFile(href, fileName);
  // A while after the click has handed the file over: revoked at once, Safari and Firefox can drop the download.
  setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 1_000);
}

function downloadFile(href: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
