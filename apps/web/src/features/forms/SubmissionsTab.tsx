// Brief
// Purpose: a form's submissions, newest first, by state, and one in full beside them (spec 0023, 0023-experience.md, Submissions tab).
// Main task: see what came in and what it became, and release, mark as spam, retry or delete one.
// Leaves out: picking the right record for one that needs review, and live arrival (both later).
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
  Button,
  Callout,
  DescriptionList,
  EmptyState,
  Modal,
  Panel,
  RecordChip,
  RelativeTime,
  SegmentedControl,
  Table,
  Badge,
  type TableColumn,
} from '@crm/ui';
import { useNavigate, useRouter, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { recordLinks } from '../records/timeline.ts';
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
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'when', label: strings.when, isRowHeader: true },
  { id: 'person', label: strings.person, isInline: true },
  { id: 'state', label: strings.state },
  { id: 'answers', label: strings.answers },
];

const ALL = 'all';
const FILTERS: readonly SubmissionState[] = ['processed', 'spam', 'needs_review', 'failed'];

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
export function SubmissionsTab({ slug, formId, objects, page, state, open, canManage }: SubmissionsTabProps) {
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

  const cell = (submission: SubmissionSummary, column: string) => {
    switch (column) {
      case 'when':
        return <RelativeTime value={submission.receivedAt} />;
      case 'person': {
        const record = submission.mainRecord;
        if (record === undefined) return submission.email ?? '';
        const href = link(record.objectId, record.recordId);
        return <RecordChip display={record} {...(href === undefined ? {} : { href })} isFlat />;
      }
      case 'state':
        return (
          <Badge
            text={strings.states[submission.state]}
            tone={submission.state === 'processed' ? 'accent' : 'neutral'}
          />
        );
      default:
        return submission.firstAnswers
          .map(answerText)
          .filter((text) => text !== '')
          .join(' · ');
    }
  };

  return (
    <>
      <SegmentedControl
        label={strings.filterStates}
        value={state ?? ALL}
        onChange={(value) => {
          go(undefined, value === ALL ? undefined : (value as SubmissionState));
        }}
        segments={[
          { value: ALL, label: strings.allStates },
          ...FILTERS.map((each) => ({ value: each, label: strings.states[each] })),
        ]}
      />
      <Table
        label={strings.tabSubmissions}
        columns={COLUMNS}
        rows={rows}
        getRowId={(submission) => submission.id}
        renderCell={cell}
        onRowAction={(id) => {
          go(id);
        }}
        emptyState={
          <EmptyState icon="inbox" title={state === undefined ? strings.noSubmissions : strings.noneInState} />
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
