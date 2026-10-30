// Brief
// Purpose: Sync earlier submissions: apply the form's current filing to earlier submissions, after a filing change goes
// live or from the editor's More menu (spec 0058, AC-14).
// Main task: see the counts (new records, updates, unchanged, can't be synced), keep Only unfiled or pick All, and
// press the one button; it runs as a background job with progress and a summary toast.
// Leaves out: choosing single submissions (Add to CRM does that), and undoing a sync.
import { isDataError, type SyncPreview, type SyncScope } from '@crm/data';
import { Button, Callout, EmptyState, Modal, SegmentedControl, Stats } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { strings } from './strings.ts';

/** Props for the sync dialog. */
export interface SyncDialogProps {
  readonly slug: string;
  readonly formId: string;
  /**
   * Why it opened: a publish that changed where answers are filed, one that started adding submissions to the
   * CRM (`connected`), or the More menu.
   */
  readonly reason: 'published' | 'connected' | 'menu';
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The sync started: its job, to follow to its end. */
  readonly onStarted: (jobId: string, total: number) => void;
}

const number = new Intl.NumberFormat();

/** The preview for one scope, read when the dialog opens or the scope changes. */
type PreviewState =
  | { readonly status: 'loading'; readonly scope: SyncScope }
  | { readonly status: 'ready'; readonly scope: SyncScope; readonly preview: SyncPreview }
  | { readonly status: 'error'; readonly scope: SyncScope; readonly message: string };

/** "Sync earlier submissions?": one line, Only unfiled or All, the counts, then Not now or "Sync 42 submissions". */
export function SyncDialog({ slug, formId, reason, isOpen, onClose, onStarted }: SyncDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  // Only unfiled first: it never touches a record already made (the safer default, as HubSpot's resync offers).
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
  // The last counts read, so a scope switch holds the row's shape while the next ones load.
  const [lastPreview, setLastPreview] = useState<SyncPreview | undefined>(undefined);
  if (preview !== undefined && preview !== lastPreview) setLastPreview(preview);

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

  // Only what would happen: a count of none says nothing. While loading, the last counts hold the row's shape (all
  // four before any are known), drawn as skeletons.
  const counted = preview ?? lastPreview;
  const counts = [
    { id: 'creates', label: strings.syncCreates, count: counted?.creates ?? 1 },
    { id: 'updates', label: strings.syncUpdates, count: counted?.updates ?? 1 },
    { id: 'unchanged', label: strings.syncUnchanged, count: counted?.unchanged ?? 1 },
    { id: 'failures', label: strings.syncFailures, count: counted?.failures ?? 1 },
  ]
    .filter((each) => each.count > 0)
    .map((each) => ({ id: each.id, label: each.label, value: number.format(each.count) }));

  return (
    <Modal
      title={strings.syncTitle}
      isOpen={isOpen}
      isBusy={isStarting}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      // Said once, beside the one button, only when some would be left as they are.
      {...(preview !== undefined && preview.failures > 0 ? { hint: strings.syncFailuresText } : {})}
      actions={
        <>
          <Button slot="close" isDisabled={isStarting}>
            {reason === 'menu' ? strings.cancel : strings.notNow}
          </Button>
          {preview?.total !== 0 && (
            <Button variant="primary" isPending={isStarting} isDisabled={preview === undefined} onPress={start}>
              {isStarting
                ? strings.syncStarting
                : preview === undefined
                  ? strings.syncStartPlain
                  : strings.syncStart(preview.total)}
            </Button>
          )}
        </>
      }
    >
      <p>
        {reason === 'connected'
          ? strings.syncTextConnected
          : reason === 'published'
            ? strings.syncTextPublished
            : strings.syncTextMenu}
      </p>
      <SegmentedControl
        label={strings.syncScope}
        isLabelVisible
        size="compact"
        isDisabled={isStarting}
        segments={[
          { value: 'unfiled', label: strings.syncUnfiled },
          { value: 'all', label: strings.syncAll },
        ]}
        value={scope}
        onChange={(value) => {
          if (value !== 'all' && value !== 'unfiled') return;
          setScope(value);
          setJobId(data.submissions.newId());
        }}
      />
      {shown.status === 'error' ? (
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
      ) : preview?.total === 0 ? (
        <EmptyState layout="row" icon="circle-check" title={strings.syncNothing}>
          {strings.syncNothingText}
        </EmptyState>
      ) : (
        // The counts are the preview: read at a glance, the total on the button that starts it.
        <Stats label={strings.syncPreview} items={counts} isLoading={shown.status === 'loading'} />
      )}
      {preview?.capped === true && <p>{strings.syncCapped(preview.checked)}</p>}
      {failure !== undefined && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
    </Modal>
  );
}
