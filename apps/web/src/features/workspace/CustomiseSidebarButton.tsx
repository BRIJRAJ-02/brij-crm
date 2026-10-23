// Brief
// Purpose: Settings › Account › Preferences' way into the Customise sidebar dialog (owner rule, 20 October 2026: every setting lives in Settings).
// Main task: open the same dialog the sidebar's section menus open, for the workspace shown.
// Leaves out: the dialog itself (lazy, CustomiseSidebarDialog) and the sidebar's own order and folds.
import type { DataLayer, ObjectSummary } from '@crm/data';
import { useNav } from '@crm/data/react';
import { Button } from '@crm/ui';
import { Suspense, useState } from 'react';
import { LazyCustomiseSidebarDialog } from './LazyCustomiseSidebarDialog.tsx';
import { strings } from './strings.ts';

/** Props for CustomiseSidebarButton. */
export interface CustomiseSidebarButtonProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly objects: readonly ObjectSummary[] | undefined;
  /**
   * A shorter visible word where the row around it already names the sidebar (Preferences' "Customise"). Its name
   * for screen readers stays "Customise sidebar", which starts with it (WCAG 2.5.3).
   */
  readonly text?: string;
}

/** A button that opens Customise sidebar, disabled until the member's sidebar is known. */
export function CustomiseSidebarButton({ data, slug, objects, text }: CustomiseSidebarButtonProps) {
  const snapshot = useNav(data.nav.source(slug));
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button
        icon="sliders-horizontal"
        {...(text === undefined ? {} : { label: strings.customiseSidebar })}
        isDisabled={snapshot.status !== 'ready'}
        onPress={() => {
          setOpen(true);
        }}
      >
        {text ?? strings.customiseSidebar}
      </Button>
      {isOpen && snapshot.status === 'ready' && (
        <Suspense fallback={null}>
          <LazyCustomiseSidebarDialog
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
