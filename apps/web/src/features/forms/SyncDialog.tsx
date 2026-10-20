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
  /** Why it opened: a publish that changed where answers are filed, or the More menu. */
  readonly reason: 'published' | 'menu';
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
export function SyncDialog({ slug, formId, reason, isOpen, onClose, onStarted }: SyncDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const [scope, setScope] = useState<SyncScope>('unfiled');
  const [state, setState] = useState<PreviewState>({ status: 'loading', scope: 'unfiled' });
  // One job id per opening, so a retried Start never starts a second sync.
  const [jobId, setJobId] = useState(() => data.submissions.newId());
  const [isStarting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // Bumped by Try again, so the preview is read again.
  const [attempt, setAttempt] = useState(0);
  // Each opening starts afresh: no counts or failure from the last one.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setState({ status: 'loading', scope });
      setFailure(undefined);
      setAttempt((count) => count + 1);
    }
  }

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
  }, [data, slug, formId, scope, isOpen, attempt]);

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
      title={strings.syncTitle}
      isOpen={isOpen}
      isBusy={isStarting}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isStarting} kbd="ESC">
            {reason === 'published' ? strings.notNow : strings.cancel}
          </Button>
          {preview?.total !== 0 && (
            <Button variant="primary" isPending={isStarting} isDisabled={preview === undefined} onPress={start}>
              {isStarting ? strings.syncStarting : strings.syncStart}
            </Button>
          )}
        </>
      }
    >
      <p>{reason === 'published' ? strings.syncTextPublished : strings.syncTextMenu}</p>
      <RadioGroup
        label={strings.syncScope}
        orientation="horizontal"
        isDisabled={isStarting}
        value={scope}
        onChange={(value) => {
          if (value !== 'all' && value !== 'unfiled') return;
          setScope(value);
          setJobId(data.submissions.newId());
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
      {shown.status === 'error' && (
        <Callout
          tone="danger"
          actions={
            <Button
              onPress={() => {
                setAttempt((count) => count + 1);
              }}
            >
              {strings.tryAgain}
            </Button>
          }
        >
          {shown.message}
        </Callout>
      )}
      {preview?.total === 0 && <p>{strings.syncNothing}</p>}
      {preview !== undefined && preview.total > 0 && (
        <>
          <p>{strings.syncInScope(preview.total)}</p>
          <DescriptionList
            items={[
              { term: strings.syncCreates, description: String(preview.creates) },
              { term: strings.syncUpdates, description: String(preview.updates) },
              { term: strings.syncUnchanged, description: String(preview.unchanged) },
              { term: strings.syncFailures, description: String(preview.failures) },
            ]}
          />
          {preview.failures > 0 && <p>{strings.syncFailuresText}</p>}
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
