// Brief
// Purpose: Won means (spec 0037, AC-1385) on Routing › Overview: which Deals stages count as won.
// Main task: pick the won stages; each pick saves at once and comes back on a refusal.
// Leaves out: what reads it (Known's Customer on a team page's rules; the Deals won objective, L9).
import { isDataError, type AttributeDefinition, type DataLayer } from '@crm/data';
import { useRoutingSettings } from '@crm/data/react';
import { Card, Select, Skeleton, type Toasts } from '@crm/ui';
import { useMemo } from 'react';
import { skillStrings as strings } from './skills-strings.ts';

/** Props for WonMeansCard. */
export interface WonMeansCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Deals' Stage field, or undefined when Deals has none the reader can see. */
  readonly stage?: AttributeDefinition;
  readonly toasts: Toasts;
}

/** The card: one multiple Select of the Stage field's live options, saved as they are picked. */
export function WonMeansCard({ data, slug, stage, toasts }: WonMeansCardProps) {
  const held = useMemo(() => data.routing.settings.view(slug), [data, slug]);
  const state = useRoutingSettings(held);
  const options = (stage?.options ?? []).filter((option) => !option.isArchived);
  const chosen =
    state.status === 'ready' && state.value.wonStage?.attributeId === stage?.id
      ? (state.value.wonStage?.optionIds ?? [])
      : [];
  return (
    <Card title={strings.wonMeans}>
      {state.status === 'loading' ? (
        <Skeleton shape="line" />
      ) : stage === undefined ? (
        strings.noStage
      ) : (
        <Select
          label={strings.wonStages}
          isLabelHidden
          selectionMode="multiple"
          optionStyle="dot"
          savesOnPick
          isDisabled={state.status === 'error'}
          items={options.map((option) => ({ id: option.id, label: option.label, hue: option.hue }))}
          values={chosen}
          onValuesChange={(ids) => {
            const wonStage = ids.length === 0 ? null : { attributeId: stage.id, optionIds: [...ids] };
            // Shown at once; only a refusal says anything.
            data.routing.settings.setWonStage(slug, wonStage).catch((error: unknown) => {
              toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failed });
            });
          }}
        />
      )}
    </Card>
  );
}
