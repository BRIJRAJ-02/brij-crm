// Brief
// Purpose: a form's submissions, newest first, by state, and one in full beside them (spec 0023, AC-572, AC-573).
// Main task: see what came in and what it became, and retry a failed one or delete one.
// Leaves out: releasing spam, picking a record for one that needs review, notices (milestone 2).
import {
  isDataError,
  type ObjectSummary,
  type SubmissionPage,
  type SubmissionState,
  type SubmissionSummary,
  type SubmissionView,
} from '@crm/data';
import {
  AttributeDisplay,
  Badge,
  Button,
  Callout,
  DescriptionList,
  EmptyState,
  Modal,
  Panel,
  RecordChip,
  RelativeTime,
  Select,
  Table,
  type TableColumn,
} from '@crm/ui';
import { useNavigate, useRouter, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { recordLinks } from '../records/timeline.ts';
import { formHref } from '../settings/nav.ts';
import { strings } from './strings.ts';

/** Props for the Submissions tab: what its route loaded through the data layer. */
export interface SubmissionsTabProps {
  readonly slug: string;
  readonly formId: string;
  readonly objects: readonly ObjectSummary[];
  /** The first page, for the state in the address. */
  readonly page: SubmissionPage;
  readonly state: SubmissionState | undefined;
  /** The submission open beside the list (`?submission=`), when it loaded. */
  readonly open: SubmissionView | undefined;
  readonly canManage: boolean;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'received', label: strings.receivedColumn, isRowHeader: true },
  { id: 'state', label: strings.statusColumn },
  { id: 'record', label: strings.recordColumn, isInline: true },
  { id: 'answer', label: strings.answerColumn },
];

/** The value of "every state" in the filter. */
const ALL = 'all';

const STATES: readonly SubmissionState[] = ['processed', 'received', 'failed', 'spam'];

/** The list, a state filter above it, and the open submission in a panel. */
export function SubmissionsTab({ slug, formId, objects, page, state, open, canManage }: SubmissionsTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const router = useRouter();
  const link = recordLinks(slug, objects);
  // Pages read past the first with Show more, for this filter only: a new filter starts from the loader's page.
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
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<'retry' | 'delete' | undefined>(undefined);
  const [isConfirmingDelete, setConfirmingDelete] = useState(false);

  const go = (submissionId?: string, nextState: SubmissionState | undefined = state) => {
    const href = formHref(slug, formId, 'submissions', submissionId);
    void navigate({ href: nextState === undefined ? href : `${href}&state=${nextState}` });
  };
  const loadMore = () => {
    const cursor = held.next;
    if (cursor === undefined || isLoadingMore) return;
    setLoadingMore(true);
    data.submissions.list(slug, formId, { ...(state === undefined ? {} : { state }), cursor }).then(
      (next) => {
        setLoadingMore(false);
        setMore({
          for: page,
          items: [...held.items, ...next.items],
          ...(next.nextCursor === undefined ? {} : { next: next.nextCursor }),
        });
      },
      (error: unknown) => {
        setLoadingMore(false);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
      },
    );
  };
  const act = (kind: 'retry' | 'delete', submissionId: string) => {
    setBusy(kind);
    const done =
      kind === 'retry' ? data.submissions.retry(slug, submissionId) : data.submissions.delete(slug, submissionId);
    done.then(
      () => {
        setBusy(undefined);
        setConfirmingDelete(false);
        toasts.toast({ tone: 'success', message: kind === 'retry' ? strings.retried : strings.deleted });
        if (kind === 'delete') go(undefined);
        else void router.invalidate();
      },
      (error: unknown) => {
        setBusy(undefined);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
      },
    );
  };

  const cell = (submission: SubmissionSummary, column: string) => {
    switch (column) {
      case 'received':
        return <RelativeTime value={submission.receivedAt} />;
      case 'state':
        return (
          <Badge
            text={strings.states[submission.state]}
            tone={submission.state === 'processed' ? 'accent' : 'neutral'}
          />
        );
      case 'record': {
        const record = submission.mainRecord;
        if (record === undefined) return null;
        const href = link(record.objectId, record.recordId);
        return <RecordChip display={record} {...(href === undefined ? {} : { href })} isFlat />;
      }
      default:
        return submission.preview ?? '';
    }
  };

  return (
    <>
      <Select
        label={strings.stateFilter}
        items={[
          { id: ALL, label: strings.allStates },
          ...STATES.map((each) => ({ id: each, label: strings.states[each] })),
        ]}
        value={state ?? ALL}
        onChange={(value) => go(undefined, value === null || value === ALL ? undefined : (value as SubmissionState))}
        size="sm"
      />
      <Table
        label={strings.submissions}
        columns={COLUMNS}
        rows={rows}
        getRowId={(submission) => submission.id}
        renderCell={cell}
        onRowAction={(id) => go(id)}
        emptyState={
          <EmptyState icon="inbox" title={state === undefined ? strings.noSubmissions : strings.noSubmissionsInState}>
            {state === undefined ? strings.noSubmissionsText : undefined}
          </EmptyState>
        }
      />
      {held.next !== undefined && (
        <Button onPress={loadMore} isPending={isLoadingMore}>
          {isLoadingMore ? strings.loadingMore : strings.loadMore}
        </Button>
      )}
      {open !== undefined && (
        <Panel
          title={strings.submission}
          isOpen
          onClose={() => go(undefined)}
          {...(canManage
            ? {
                footer: (
                  <>
                    {open.state === 'failed' && (
                      <Button variant="primary" isPending={busy === 'retry'} onPress={() => act('retry', open.id)}>
                        {busy === 'retry' ? strings.retrying : strings.retry}
                      </Button>
                    )}
                    <Button variant="ghost" icon="trash" onPress={() => setConfirmingDelete(true)}>
                      {strings.delete}
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
        title={strings.deleteTitle}
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
              {strings.delete}
            </Button>
          </>
        }
      >
        <p>{strings.deleteText}</p>
      </Modal>
    </>
  );
}

/** One submission: where it is, its answers through each type's one display, and the records it touched. */
function SubmissionDetail({
  submission,
  link,
}: {
  readonly submission: SubmissionView;
  readonly link: ReturnType<typeof recordLinks>;
}) {
  const facts = [
    { term: strings.statusColumn, description: strings.states[submission.state] },
    { term: strings.received, description: <RelativeTime value={submission.receivedAt} /> },
    ...(submission.processedAt === undefined
      ? []
      : [{ term: strings.processed, description: <RelativeTime value={submission.processedAt} /> }]),
    { term: strings.version, description: String(submission.versionNumber) },
    { term: strings.verdict, description: strings.verdicts[submission.verdict] },
    ...(submission.hidden.utm_source === undefined
      ? []
      : [{ term: strings.source, description: submission.hidden.utm_source }]),
    ...(submission.assignment === undefined
      ? []
      : [
          {
            term: strings.assigned,
            description: strings.assignment[submission.assignment.reason] ?? submission.assignment.reason,
          },
        ]),
  ];
  return (
    <>
      {submission.failure !== undefined && (
        <Callout tone="danger" title={strings.failure}>
          {submission.failure}
        </Callout>
      )}
      {submission.refused.length > 0 && (
        <Callout tone="warning" title={strings.refused}>
          {submission.refused
            .map((refusal) => {
              const label = submission.answers.find((answer) => answer.questionId === refusal.questionId)?.label;
              return `${label ?? refusal.questionId}: ${refusal.message}`;
            })
            .join(' ')}
        </Callout>
      )}
      <DescriptionList items={facts} />
      <h3>{strings.answers}</h3>
      <DescriptionList
        layout="stacked"
        items={submission.answers.map((answer) => ({
          term: answer.label,
          description: (
            <AttributeDisplay
              attribute={{
                id: answer.questionId,
                name: answer.label,
                type: answer.type,
                allowMultiple: Array.isArray(answer.value),
                ...(answer.options === undefined
                  ? {}
                  : {
                      options: answer.options.map((option) => ({
                        id: option.id,
                        label: option.label,
                        hue: option.hue ?? 'gray',
                        archived: false,
                      })),
                    }),
                isRequired: false,
                isUnique: false,
                isReadOnly: true,
              }}
              value={answer.value ?? null}
              surface="panel"
            />
          ),
        }))}
      />
      {submission.records.length > 0 && (
        <>
          <h3>{strings.records}</h3>
          <DescriptionList
            items={submission.records.map((touched) => {
              const href = link(touched.record.objectId, touched.record.recordId);
              return {
                term: `${strings.roles[touched.role]} · ${strings.actions[touched.action]}`,
                description: <RecordChip display={touched.record} {...(href === undefined ? {} : { href })} />,
              };
            })}
          />
        </>
      )}
    </>
  );
}
