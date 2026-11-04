// Brief
// Purpose: Settings › Keep submissions on a form (lane 3c): the workspace's own setting, under its own name, as a
//   field height Select, so the form's Settings reads in one control height (it was a 26px button to General).
// Main task: see how long submissions are kept, and change it here without a trip to Settings › General.
// Leaves out: anything per form: it is the workspace's, and its InfoTip says every form shares it.
import { isDataError, type DataLayer } from '@crm/data';
import { Button, InfoTip, Modal, Select, SettingsRow } from '@crm/ui';
import { useRef, useState } from 'react';
import { strings as workspaceStrings } from '../settings/workspace-strings.ts';
import { strings } from './strings.ts';

/** The choices, as Settings › General names them. */
const KEEP_CHOICES = ['forever', '12', '24'] as const;
type KeepChoice = (typeof KEEP_CHOICES)[number];

const choiceOf = (months: 12 | 24 | null): KeepChoice => (months === null ? 'forever' : months === 12 ? '12' : '24');

function monthsOf(choice: string | null): 12 | 24 | null | undefined {
  if (choice === 'forever') return null;
  if (choice === '12') return 12;
  if (choice === '24') return 24;
  return undefined;
}

/** What a count of older submissions reads as while the confirm is open. */
type Beyond = { readonly count: number; readonly isAtLeast: boolean } | 'counting' | 'unknown';

/** Props for KeepSubmissionsRow. */
export interface KeepSubmissionsRowProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** What the workspace keeps now (null: forever), as the route read it. */
  readonly months: number | null;
  /** Whether the reader may change workspace settings (`workspace.manage`); otherwise the Select is read only. */
  readonly canChange: boolean;
  /** Says a change in a toast, with Undo. */
  readonly onSaved: (message: string, undo: () => void) => void;
  readonly onFailed: (message: string) => void;
}

/**
 * The row: Keep submissions, its InfoTip, and the Select. Keeping them longer saves at once; a shorter time deletes
 * the older ones tonight, so it asks first, counting them, as Settings › General does.
 */
export function KeepSubmissionsRow({ data, slug, months, canChange, onSaved, onFailed }: KeepSubmissionsRowProps) {
  const known: 12 | 24 | null = months === 12 || months === 24 ? months : null;
  // Only a pick on its way is held here; otherwise the route's read shows, so a change made in Settings › General
  // (or by another admin) shows when the route reads again.
  const [pending, setPending] = useState<{ readonly months: 12 | 24 | null } | undefined>(undefined);
  const saved = pending === undefined ? known : pending.months;
  // The shorter time the confirm is counting for: a late count for an earlier pick is dropped.
  const asked = useRef<12 | 24 | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const [shorten, setShorten] = useState<{ readonly next: 12 | 24; readonly was: 12 | 24 | null } | undefined>();
  const [beyond, setBeyond] = useState<Beyond>('counting');

  const save = (next: 12 | 24 | null, was: 12 | 24 | null) => {
    setBusy(true);
    setPending({ months: next });
    data.workspace
      .update(slug, { keepSubmissionsMonths: next })
      .then(() => {
        onSaved(workspaceStrings.keepChanged(next ?? undefined), () => {
          save(was, next);
        });
      })
      .catch((error: unknown) => {
        setPending({ months: was });
        onFailed(isDataError(error) ? error.message : strings.failedText);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <SettingsRow
        title={strings.keptRow}
        meta={<InfoTip label={strings.keptRow}>{strings.keptHelp}</InfoTip>}
        // Its reach in view, not only on hover: a change here changes every form (UX review, lane 3c).
        description={strings.keptAllForms}
        control="field"
      >
        <Select
          savesOnPick
          label={strings.keptRow}
          isLabelHidden
          items={KEEP_CHOICES.map((id) => ({ id, label: workspaceStrings.keepChoices[id] }))}
          value={choiceOf(saved)}
          isReadOnly={!canChange}
          isDisabled={isBusy}
          onChange={(choice) => {
            const next = monthsOf(choice);
            if (next === undefined || next === saved) return;
            if (next === null || (saved !== null && next > saved)) {
              save(next, saved);
              return;
            }
            setBeyond('counting');
            setShorten({ next, was: saved });
            asked.current = next;
            data.workspace
              .submissionsBeyond(slug, next)
              .then((found) => {
                if (asked.current === next) setBeyond(found);
              })
              .catch(() => {
                if (asked.current === next) setBeyond('unknown');
              });
          }}
        />
      </SettingsRow>
      <Modal
        title={workspaceStrings.shortenTitle(shorten?.next ?? 12)}
        variant="confirm"
        tone="danger"
        isOpen={shorten !== undefined}
        onOpenChange={(open) => {
          if (!open) setShorten(undefined);
        }}
        actions={
          <>
            <Button slot="close">{workspaceStrings.cancel}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                if (shorten !== undefined) save(shorten.next, shorten.was);
                setShorten(undefined);
              }}
            >
              {workspaceStrings.shortenAction}
            </Button>
          </>
        }
      >
        {`${workspaceStrings.shortenText(shorten?.next ?? 12, beyond)} ${strings.keptEveryForm}`}
      </Modal>
    </>
  );
}
