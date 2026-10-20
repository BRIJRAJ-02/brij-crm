// Brief
// Purpose: Sync old records: apply the form's current mapping to earlier enquiries, after a mapping change goes live
// or from Submissions' More menu.
// Main task: see what would change (creates, updates, unchanged, failures), pick All or Only unfiled, and start it;
// it runs as a background job with progress and a summary toast.
// Leaves out: choosing single enquiries (Add to CRM does that), and undoing a sync.
import { isDataError, type SyncPreview, type SyncScope } from '@crm/data';
import { Button, Callout, DescriptionList, Modal, Radio, RadioGroup, Skeleton } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { strings } from './strings.ts';

/** Props for the sync dialog. */
export interface SyncDialogProps {
  readonly slug: string;
  readonly formId: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The sync started: its job, to follow to its end. */
  readonly onStarted: (jobId: string, total: number) => void;
}

/** The preview for one scope, read when the dialog opens or the scope changes. */
type PreviewState =
  | { readonly status: 'loading'; readonly scope: SyncScope }
  | { readonly status: 'ready'; readonly scope: SyncScope; readonly preview: SyncPreview }
  | { readonly status: 'error'; readonly scope: SyncScope; readonly message: string };

/** "Apply to the 42 earlier enquiries?": the preview, the scope, and Start or Not now. */
export function SyncDialog({ slug, formId, isOpen, onClose, onStarted }: SyncDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const [scope, setScope] = useState<SyncScope>('unfiled');
  const [state, setState] = useState<PreviewState>({ status: 'loading', scope: 'unfiled' });
  // One job id per opening, so a retried Start never starts a second sync.
  const [jobId, setJobId] = useState(() => data.submissions.newId());
  const [isStarting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isOpen) return;
    let isCurrent = true;
    data.forms.syncPreview(slug, formId, scope).then(
      (preview) => {
        if (isCurrent) setState({ status: 'ready', scope, preview });
      },
      (error: unknown) => {
        if (isCurrent) {
          setState({ status: 'error', scope, message: isDataError(error) ? error.message : strings.failedText });
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, formId, scope, isOpen]);

  // A scope just changed and its preview is on its way.
  const shown: PreviewState = state.scope === scope ? state : { status: 'loading', scope };
  const preview = shown.status === 'ready' ? shown.preview : undefined;

  const start = () => {
    if (isStarting) return;
    setStarting(true);
    setFailure(undefined);
    data.forms.syncStart(slug, formId, scope, jobId).then(
      (started) => {
        setStarting(false);
        setJobId(data.submissions.newId());
        onStarted(started.jobId, started.total);
      },
      (error: unknown) => {
        setStarting(false);
        setFailure(isDataError(error) ? error.message : strings.failedText);
      },
    );
  };

  return (
    <Modal
      title={preview === undefined ? strings.syncTitleAny : strings.syncTitle(preview.total)}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isStarting}>
            {strings.notNow}
          </Button>
          <Button
            variant="primary"
            isPending={isStarting}
            isDisabled={preview === undefined || preview.total === 0}
            onPress={start}
          >
            {isStarting ? strings.syncStarting : strings.syncStart}
          </Button>
        </>
      }
    >
      <p>{strings.syncText}</p>
      <RadioGroup
        label={strings.syncScope}
        orientation="horizontal"
        value={scope}
        onChange={(value) => {
          if (value === 'all' || value === 'unfiled') setScope(value);
        }}
      >
        <Radio value="unfiled" description={strings.syncUnfiledText}>
          {strings.syncUnfiled}
        </Radio>
        <Radio value="all" description={strings.syncAllText}>
          {strings.syncAll}
        </Radio>
      </RadioGroup>
      {shown.status === 'loading' && <Skeleton lines={4} />}
      {shown.status === 'error' && <Callout tone="danger">{shown.message}</Callout>}
      {preview !== undefined && (
        <>
          <DescriptionList
            items={[
              { term: strings.syncCreates, description: String(preview.creates) },
              { term: strings.syncUpdates, description: String(preview.updates) },
              { term: strings.syncUnchanged, description: String(preview.unchanged) },
              { term: strings.syncFailures, description: String(preview.failures) },
            ]}
          />
          {preview.capped && <p>{strings.syncCapped(preview.checked)}</p>}
        </>
      )}
      {failure !== undefined && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
    </Modal>
  );
}
