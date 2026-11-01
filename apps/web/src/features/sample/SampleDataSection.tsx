// Brief
// Purpose: Settings › General's Sample data row: try the CRM on a realistic set, then take it away in one action.
// Main task: one button, Add sample data or Remove sample data (with Undo), for owners and admins.
// Leaves out: choosing what to add (no questions, owner rule), and editing sample records apart from real ones.
import { Button, Card, InfoTip, SettingsRow, SettingsSection, Skeleton } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { addSampleData, removeSampleData } from './sample.ts';
import { strings } from './strings.ts';
import { useSample } from './useSample.ts';

/** Props for the Sample data section. */
export interface SampleDataSectionProps {
  readonly slug: string;
}

/**
 * The Sample data row, for owners and admins only (others never see it). The button is busy while the job runs and
 * turns to Remove once the set is in; the data layer reads the state again after each change and the job's end.
 */
export function SampleDataSection({ slug }: SampleDataSectionProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const mayManage = useCan('schema.manage');
  const sample = useSample(slug, mayManage);
  const [isBusy, setBusy] = useState(false);
  if (!mayManage || sample.status === 'error') return null;
  if (sample.status === 'ready' && !sample.state.canManage) return null;
  const isPresent = sample.status === 'ready' && sample.state.present;
  const isRunning = sample.status === 'ready' && sample.state.jobId !== undefined;
  const press = () => {
    setBusy(true);
    void (isPresent ? removeSampleData(data, toasts, slug) : addSampleData(data, toasts, slug)).finally(() => {
      setBusy(false);
    });
  };
  return (
    <SettingsSection title={strings.title}>
      <Card isBusy={sample.status === 'loading'}>
        <SettingsRow title={strings.rowTitle} meta={<InfoTip label={strings.rowTitle}>{strings.info}</InfoTip>}>
          {sample.status === 'loading' ? (
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
