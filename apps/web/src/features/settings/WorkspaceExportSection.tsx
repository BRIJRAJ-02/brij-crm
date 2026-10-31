// Brief
// Purpose: Settings › Workspace › General's Your data (lane wip/crm-dataio, scope #37): an owner takes everything out.
// Main task: press Export, watch it run, then Download the zip (kept 24 hours); Cancel stops it, asked first.
// Leaves out: choosing what goes in (it is everything), backups and restores (infra), and email (the toast says it).
import type { DataLayer, JobView } from '@crm/data';
import { isDataError } from '@crm/data';
import { useJobs } from '@crm/data/react';
import { Button, Card, Modal, ProgressBar, SettingsRow, SettingsSection, type Toasts } from '@crm/ui';
import { useMemo, useState } from 'react';
import { exportState, HOUR_MS } from './workspace-export.ts';
import { strings } from './workspace-strings.ts';

/** Props for Your data. */
export interface WorkspaceExportSectionProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
}

/**
 * One row: Export everything with Export; while it runs, a progress bar of the rows written with Cancel (a confirm);
 * when ready, how big it is and when it goes, with Download and a quiet Export again. A failed one says why and
 * offers Export again. Read from the member's jobs (the Background jobs page's view), so it follows the job live and
 * is right on a later visit.
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
    const settle = () => {
      setStopping(false);
      setAsking(false);
    };
    data.jobs.cancel(slug, job.id).then(settle, settle);
  };

  const exportButton = (label: string, variant?: 'ghost') => (
    <Button
      {...(variant === undefined ? {} : { variant })}
      icon="download"
      isPending={isStarting}
      isDisabled={isLoading}
      onPress={start}
    >
      {label}
    </Button>
  );

  return (
    <SettingsSection title={strings.yourData}>
      <Card>
        {state.kind === 'running' ? (
          <SettingsRow
            title={strings.exportEverything}
            control="field"
            description={<ProgressBar label={strings.exportingRows(state.job.done)} isIndeterminate />}
          >
            {state.job.cancellable && (
              <Button variant="ghost" onPress={() => setAsking(true)}>
                {strings.cancelExport}
              </Button>
            )}
          </SettingsRow>
        ) : state.kind === 'ready' ? (
          <SettingsRow
            title={strings.exportEverything}
            description={strings.exportReady(
              typeof state.job.result?.bytes === 'number' ? state.job.result.bytes : undefined,
              Math.max(1, Math.ceil((state.expiresAt - now) / HOUR_MS)),
            )}
          >
            {exportButton(strings.exportAgain, 'ghost')}
            <Button
              variant="primary"
              icon="download"
              onPress={() => {
                window.location.assign(data.exports.downloadPath(slug, state.exportId));
              }}
            >
              {strings.download}
            </Button>
          </SettingsRow>
        ) : (
          <SettingsRow
            title={strings.exportEverything}
            description={
              state.kind === 'failed' ? strings.exportEnded(state.job.error?.message) : strings.exportEverythingText
            }
          >
            {exportButton(state.kind === 'failed' ? strings.exportAgain : strings.export)}
          </SettingsRow>
        )}
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
