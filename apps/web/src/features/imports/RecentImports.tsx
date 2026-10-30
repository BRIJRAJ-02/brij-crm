// The upload step's Recent imports (owner walk 30 Oct 2026): the member's own
// imports into this object from the jobs they started, newest first, each
// linking to its summary (named by the file the job's summary carries), with
// how long its undo stays open. Read through the
// data layer's jobs view, the one the Background jobs page reads.
import type { DataLayer, JobView, MemberSummary, ObjectSummary } from '@crm/data';
import { useJobs } from '@crm/data/react';
import { Card, Link, RelativeTime, Table, type TableColumn } from '@crm/ui';
import { useMemo } from 'react';
import { importSummaryHref } from './paths.ts';
import { strings } from './strings.ts';

/** The import job's kind, and its undo's (`@crm/core`'s `RECORDS_IMPORT`, `RECORDS_IMPORT_UNDO`). */
const IMPORT_KIND = 'records.import';
const UNDO_KIND = 'records.import_undo';
/** How long undo stays open after a start (owner decision 3). */
const UNDO_DAYS = 7;
/** The most rows the list shows. */
const SHOWN = 5;

const COLUMNS: readonly TableColumn[] = [
  { id: 'file', label: strings.recent.file, isRowHeader: true },
  { id: 'by', label: strings.recent.by },
  { id: 'when', label: strings.recent.when },
  { id: 'rows', label: strings.recent.rows },
  { id: 'undo', label: strings.recent.undo },
];

/** One import as the list shows it. */
interface RecentImport {
  readonly id: string;
  readonly job: JobView;
  readonly isUndone: boolean;
}

/** The import a job belongs to, from its summary (`{ importId }`). */
const importOf = (job: JobView): string | undefined =>
  typeof job.result?.importId === 'string' ? job.result.importId : undefined;

/** The imports into `objectId` among jobs, newest first, each marked when an undo of it has run. */
export function recentImports(jobs: readonly JobView[], objectId: string): readonly RecentImport[] {
  const undone = new Set(jobs.filter((job) => job.kind === UNDO_KIND).flatMap((job) => importOf(job) ?? []));
  return jobs
    .filter((job) => job.kind === IMPORT_KIND && job.subject?.id === objectId)
    .flatMap((job) => {
      const id = importOf(job);
      return id === undefined ? [] : [{ id, job, isUndone: undone.has(id) }];
    })
    .slice(0, SHOWN);
}

/** When an import's undo closes: 7 days after it started, as the server sets it. */
const undoUntil = (job: JobView): string =>
  new Date(Date.parse(job.startedAt ?? job.createdAt) + UNDO_DAYS * 86_400_000).toISOString();

/** Props for Recent imports. */
export interface RecentImportsProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly members: readonly MemberSummary[];
  /** Now, from the page's clock, for whether an undo window is still open. */
  readonly now: number;
}

/** The member's last imports into this object, under the upload card; nothing when there are none. */
export function RecentImports({ data, slug, object, members, now }: RecentImportsProps) {
  const view = useMemo(() => data.jobs.view(slug, 'mine'), [data, slug]);
  const snapshot = useJobs(view);
  const rows = recentImports(snapshot.jobs, object.id);
  if (rows.length === 0) return null;
  const names = new Map(members.map((member) => [member.id, member.name]));
  return (
    <Card title={strings.recent.title}>
      <Table
        label={strings.recent.title}
        columns={COLUMNS}
        rows={rows}
        getRowId={(row) => row.id}
        renderCell={(row, columnId) => {
          const { job } = row;
          if (columnId === 'file') {
            const name = typeof job.result?.fileName === 'string' ? job.result.fileName : job.label;
            return <Link href={importSummaryHref(slug, object, row.id)}>{name}</Link>;
          }
          if (columnId === 'by') return names.get(job.startedBy.memberId ?? '') ?? strings.recent.formerMember;
          if (columnId === 'when') return <RelativeTime value={job.startedAt ?? job.createdAt} />;
          if (columnId === 'rows') {
            return job.finishedAt === undefined ? strings.running : strings.recent.counts(job.done, job.refused);
          }
          if (row.isUndone) return strings.recent.undone;
          const until = undoUntil(job);
          return job.status === 'succeeded' && Date.parse(until) > now ? (
            <RelativeTime value={until} />
          ) : (
            strings.recent.closed
          );
        }}
      />
    </Card>
  );
}
