// Brief
// Purpose: an object with no view this person may open (spec 0020, AC-462) still lets them start one.
// Main task: Create view, which opens once the server made it.
// Leaves out: why the shared views are absent (hidden is absent, spec 0009).
import type { AttributeDefinition, ObjectSummary } from '@crm/data';
import { Button, EmptyState, TopBar } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { CreateViewDialog } from './CreateViewDialog.tsx';
import { startingConfig } from './layout.ts';
import { strings } from './strings.ts';

/** Props for the no view screen. */
export interface NoViewsScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
}

/** "No views are available to you", with Create view (the create dialog, starting from the default config). */
export function NoViewsScreen({ slug, object, attributes }: NoViewsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const [isCreating, setCreating] = useState(false);
  return (
    <WorkspacePage
      currentObject={object.apiSlug}
      page={{
        topBar: <TopBar title={object.pluralName} icon={object.icon} hue={object.hue} />,
        body: (
          <>
            <EmptyState
              icon="layout-grid"
              title={strings.noViewsTitle}
              actions={
                <Button
                  variant="primary"
                  icon="plus"
                  onPress={() => {
                    setCreating(true);
                  }}
                >
                  {strings.createView}
                </Button>
              }
            >
              {strings.noViewsText}
            </EmptyState>
            <CreateViewDialog
              mode={isCreating ? 'create' : undefined}
              onClose={() => {
                setCreating(false);
              }}
              objectId={object.id}
              newId={data.views.newId}
              canStartFromView={false}
              configFor={() => startingConfig(undefined, object, attributes)}
              onCreate={(input) => data.views.create(slug, input)}
              onCreated={(made) => {
                setCreating(false);
                toasts.toast({ tone: 'success', message: strings.created(made.name) });
                void navigate({
                  to: '/w/$slug/objects/$object/views/$viewId',
                  params: { slug, object: object.apiSlug, viewId: made.id },
                });
              }}
            />
          </>
        ),
      }}
    />
  );
}
