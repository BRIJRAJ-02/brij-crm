// Brief
// Purpose: Settings › General's Sample data row: try the CRM on a realistic set, then take it away in one action.
// Main task: one button, Add sample data or Remove sample data (with Undo), for owners and admins.
// Leaves out: choosing what to add (no questions, owner rule), and editing sample records apart from real ones.
import type { SampleDataState } from '@crm/data';
import { Button, Card, InfoTip, SettingsRow, SettingsSection, Skeleton } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { addSampleData, removeSampleData } from './sample.ts';
import { strings } from './strings.ts';

/** Props for the Sample data section. */
export interface SampleDataSectionProps {
  readonly slug: string;
}

/**
 * The Sample data row. It reads the workspace's state once it shows, and again after each press; a member who may
 * not manage it, or a read that failed, sees no row at all.
 */
export function SampleDataSection({ slug }: SampleDataSectionProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [state, setState] = useState<SampleDataState | 'loading' | 'failed'>('loading');
  const [isBusy, setBusy] = useState(false);
  const read = useCallback(() => {
    data.sampleData.get(slug).then(setState, () => {
      setState('failed');
    });
  }, [data, slug]);
  useEffect(() => {
    read();
  }, [read]);

  if (state === 'failed' || (state !== 'loading' && !state.canManage)) return null;
  const isRunning = state !== 'loading' && state.jobId !== undefined;
  const isPresent = state !== 'loading' && state.present;
  const press = () => {
    setBusy(true);
    void (isPresent ? removeSampleData(data, toasts, slug) : addSampleData(data, toasts, slug)).finally(() => {
      setBusy(false);
      read();
    });
  };
  return (
    <SettingsSection title={strings.title}>
      <Card>
        <SettingsRow title={strings.title} meta={<InfoTip label={strings.title}>{strings.info}</InfoTip>}>
          {state === 'loading' ? (
            <Skeleton width="short" />
          ) : (
            <Button
              variant="secondary"
              icon={isPresent ? 'trash' : 'database'}
              isPending={isBusy || isRunning}
              onPress={press}
            >
              {isPresent ? strings.remove : strings.add}
            </Button>
          )}
        </SettingsRow>
      </Card>
    </SettingsSection>
  );
}
