// Brief
// Purpose: Settings › Workspace › General's Your data (lane wip/crm-dataio, scope #37): an owner takes everything out.
// Main task: press Export, watch it run, then Download the zip (kept 24 hours); Cancel stops it, asked first.
// Leaves out: choosing what goes in (it is everything), backups and restores (infra), and email (the toast says it).
import type { DataLayer, JobView } from '@crm/data';
import { isDataError } from '@crm/data';
import { useJobs } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Card,
  focusLater,
  Modal,
  ProgressBar,
  SettingsRow,
  SettingsSection,
  type Toasts,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { exportState, HOUR_MS, type ExportState } from './workspace-export.ts';
import { strings } from './workspace-strings.ts';

/** Props for Your data. */
export interface WorkspaceExportSectionProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
}

/** The row's one line under its title, for each state. */
function descriptionOf(state: ExportState, now: number) {
  switch (state.kind) {
    case 'running':
      return <ProgressBar label={strings.exportingRows(state.job.done)} isIndeterminate />;
    case 'ready':
      return strings.exportReady(
        typeof state.job.result?.bytes === 'number' ? state.job.result.bytes : undefined,
        Math.max(1, Math.ceil((state.expiresAt - now) / HOUR_MS)),
      );
    case 'failed':
      return strings.exportEnded(state.job.error?.message);
    case 'none':
      return strings.exportEverythingText;
  }
}

/**
 * One row, its control swapped in place: Export; while it runs, a progress bar of the rows written with Cancel
 * export (a confirm); when ready, its size and when it goes, with Download and a quiet Export again; a failed one
 * says why with Export again. Read from the member's jobs (the Background jobs page's view), so it follows the job
 * live and is right on a later visit. When the control in use goes with a change, focus moves to the new one.
 */
export function WorkspaceExportSection({ data, toasts, slug }: WorkspaceExportSectionProps) {
  const view = useMemo(() => data.jobs.view(slug, 'mine'), [data, slug]);
  const jobs = useJobs(view);
  const [isStarting, setStarting] = useState(false);
  const [isAsking, setAsking] = useState(false);
  const [isStopping, setStopping] = useState(false);
  // The page's own moment, read once: a file's last hours aren't counted down live.
  const [now] = useState(() => Date.now());
  const state = exportState(jobs.jobs, now);
  const isLoading = jobs.status === 'loading';
  const controlRef = useRef<HTMLButtonElement>(null);

  // The pressed control goes with the change (Export becomes Cancel, Cancel becomes Export, the file arrives):
  // focus left on the page moves to the row's new control, never to the page's start.
  const kind = state.kind;
  const shownKind = useRef(kind);
  useEffect(() => {
    if (shownKind.current === kind) return;
    shownKind.current = kind;
    focusLater(() =>
      document.activeElement === null || document.activeElement === document.body ? controlRef.current : undefined,
    );
  }, [kind]);

  const start = () => {
    if (isStarting) return;
    setStarting(true);
    data.exports.startWorkspace(slug, data.exports.newId()).then(
      () => {
        setStarting(false);
      },
      (error: unknown) => {
        setStarting(false);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.exportFailed });
      },
    );
  };
  const stop = (job: JobView) => {
    if (isStopping) return;
    setStopping(true);
    data.jobs.cancel(slug, job.id).then(
      (landed) => {
        setStopping(false);
        setAsking(false);
        if (!landed) toasts.toast({ tone: 'danger', message: strings.cancelFailed });
      },
      () => {
        setStopping(false);
        setAsking(false);
        toasts.toast({ tone: 'danger', message: strings.cancelFailed });
      },
    );
  };

  return (
    <SettingsSection title={strings.yourData}>
      <Card>
        <SettingsRow title={strings.exportEverything} description={descriptionOf(state, now)}>
          {state.kind === 'running' ? (
            state.job.cancellable ? (
              <Button ref={controlRef} variant="ghost" onPress={() => setAsking(true)}>
                {strings.cancelExport}
              </Button>
            ) : undefined
          ) : (
            <>
              <Button
                ref={controlRef}
                {...(state.kind === 'ready' ? { variant: 'ghost' as const } : { icon: 'download' as const })}
                isPending={isStarting}
                isDisabled={isLoading}
                onPress={start}
              >
                {state.kind === 'none' ? strings.export : strings.exportAgain}
              </Button>
              {state.kind === 'ready' && (
                <ButtonLink variant="primary" icon="download" href={data.exports.downloadPath(slug, state.exportId)}>
                  {strings.download}
                </ButtonLink>
              )}
            </>
          )}
        </SettingsRow>
      </Card>
      <Modal
        title={strings.cancelExportTitle}
        variant="confirm"
        tone="danger"
        isOpen={isAsking && state.kind === 'running'}
        isBusy={isStopping}
        onOpenChange={(open) => {
          if (!open && !isStopping) setAsking(false);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isStopping}>
              {strings.keepExporting}
            </Button>
            <Button
              variant="danger-solid"
              isPending={isStopping}
              onPress={() => {
                if (state.kind === 'running') stop(state.job);
              }}
            >
              {strings.stopExport}
            </Button>
          </>
        }
      >
        {strings.cancelExportText}
      </Modal>
    </SettingsSection>
  );
}
