// Brief
// Purpose: Settings › Account › Preferences' way into the Customise sidebar dialog (owner rule, 20 October 2026: every setting lives in Settings).
// Main task: open the same dialog the sidebar's section menus open, for the workspace shown.
// Leaves out: the dialog itself (lazy, CustomiseSidebarDialog) and the sidebar's own order and folds.
import type { DataLayer, ObjectSummary } from '@crm/data';
import { useNav } from '@crm/data/react';
import { Button } from '@crm/ui';
import { lazy, Suspense, useState } from 'react';
import { strings } from './strings.ts';

const CustomiseSidebarDialog = lazy(() =>
  import('./CustomiseSidebarDialog.tsx').then((module) => ({ default: module.CustomiseSidebarDialog })),
);

/** Props for CustomiseSidebarButton. */
export interface CustomiseSidebarButtonProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly objects: readonly ObjectSummary[] | undefined;
}

/** A button that opens Customise sidebar, disabled until the member's sidebar is known. */
export function CustomiseSidebarButton({ data, slug, objects }: CustomiseSidebarButtonProps) {
  const snapshot = useNav(data.nav.source(slug));
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button
        icon="sliders-horizontal"
        isDisabled={snapshot.status !== 'ready'}
        onPress={() => {
          setOpen(true);
        }}
      >
        {strings.customiseSidebar}
      </Button>
      {isOpen && snapshot.status === 'ready' && (
        <Suspense fallback={null}>
          <CustomiseSidebarDialog
            data={data}
            slug={slug}
            nav={snapshot.nav}
            objects={objects}
            isOpen={isOpen}
            onOpenChange={setOpen}
          />
        </Suspense>
      )}
    </>
  );
}
