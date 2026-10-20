// Brief
// Purpose: a form's submissions (spec 0023): who sent what and when, newest first, with what needs a look on top.
// Main task: scan the people and their first answers, open one in full, and settle many at once (spam or not).
// Leaves out: CSV export, Add to CRM and Sync old records (the spam lane's backend), counts per state, server search
// (search filters the rows loaded so far), and live arrival.
import {
  isDataError,
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
  /** The form's questions, for the answer columns (the first two) by their labels. */
  readonly questions: readonly { readonly id: string; readonly label: string }[];
  /** The form's public link, for the empty state's Copy link. */
  readonly link: string;
}

/** How many answers get a column of their own; the rest are in the open submission. */
const ANSWER_COLUMNS = 2;

const ALL = 'all';
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

  // Search narrows the rows loaded so far, by the person's name or email.
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? rows
      : rows.filter((submission) =>
          [submission.mainRecord?.name, submission.email].some((text) => text?.toLowerCase().includes(needle) === true),
        );
  const waiting = rows.filter((submission) => submission.state === 'needs_review').length;
  // What a bulk action acts on: the picked rows still in view (a filter or a search may hide some).
  const picked = shown.filter((submission) => selected.has(submission.id));
  const canRelease = picked.some((submission) => submission.state === 'spam' || submission.state === 'needs_review');
  const canMarkSpam = picked.some((submission) => submission.state !== 'spam');
  const columns: readonly TableColumn[] = [
    { id: 'person', label: strings.person, isRowHeader: true, isInline: true },
    { id: 'when', label: strings.when },
    { id: 'state', label: strings.state },
    // The questions the list carries answers for (the server sends each row's first answers), in the form's order.
    // A question earns a column when some row has an answer to it that the Person column doesn't already say.
    ...questions
      .filter((question) =>
        shown.some((submission) => {
          const answer = submission.firstAnswers.find((each) => each.questionId === question.id);
          const text = answer === undefined ? '' : answerText(answer).trim();
          return text !== '' && text !== submission.mainRecord?.name;
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

  // Export, Add to CRM and Sync old records wait on the submissions backend (paused): shown, off, each saying so.
  const moreActions = (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={strings.moreSubmissionActions} />
      <Menu label={strings.moreSubmissionActions} disabledKeys={['export', 'file', 'sync']}>
        <MenuItem id="export" icon="download" description={strings.exportSoon}>
          {strings.exportCsv}
        </MenuItem>
        <MenuItem id="file" icon="user-plus" description={strings.addToCrmSoon}>
          {strings.addToCrm}
        </MenuItem>
        <MenuItem id="sync" icon="refresh-cw" description={strings.syncSoon}>
          {strings.syncOld}
        </MenuItem>
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
              ...FILTERS.map((each) => ({ id: each, label: strings.states[each] })),
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
        const record = submission.mainRecord;
        // Not filed: the email, and that it isn't in the CRM yet.
        if (record === undefined) return strings.notInCrm(submission.email);
        const href = link(record.objectId, record.recordId);
        return <RecordChip display={record} {...(href === undefined ? {} : { href })} isFlat />;
      }
      case 'state':
        return <StatusDot hue={STATE_HUES[submission.state]}>{strings.states[submission.state]}</StatusDot>;
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
          <SubmissionDetail submission={open} link={link} />
        </Panel>
      )}
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
}: {
  readonly submission: SubmissionView;
  readonly link: ReturnType<typeof recordLinks>;
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
          { term: strings.state, description: strings.states[submission.state] },
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
