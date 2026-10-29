// Brief
// Purpose: a Captures editor (a booking page's, a form's) while its route loads, in the editor's own shape.
// Main task: hold the TopBar, its tab strip, the editor's cards down the left and the preview on the right where they will land.
// Leaves out: anything the editor reads (titles of its cards come from the caller, the rest is skeleton).
import { Card, PreviewLayout, Skeleton, TabPanel, Tabs, TopBar, type IconName } from '@crm/ui';
import type { ReactNode } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';

/** Props for EditorPending. */
export interface EditorPendingProps {
  /** The TopBar's name while it loads ("Booking pages", "Forms"), for screen readers. */
  readonly title: string;
  readonly icon: IconName;
  /** The editor's cards, by title, in order: the first ones on screen. */
  readonly cards: readonly string[];
  /** The editor's notices above its cards, when they are known already (a booking page's calendar note). */
  readonly notices?: ReactNode;
  /**
   * The editor's tab strip, when it has one: its name, its tabs and the one shown, the others disabled until the
   * editor lands. The cards then sit in that tab's panel, where the loaded one draws them.
   */
  readonly tabs?: {
    readonly label: string;
    readonly items: readonly { readonly id: string; readonly label: string }[];
    readonly shown: string;
  };
}

/**
 * The editor's layout with skeleton content: the TopBar loading, each card titled and busy, and the preview's
 * place, so the editor lands where its skeleton stood.
 */
export function EditorPending({ title, icon, cards, notices, tabs }: EditorPendingProps) {
  const layout = (
    <PreviewLayout preview={<Skeleton shape="block" />} {...(notices === undefined ? {} : { notices })}>
      {cards.map((card) => (
        <Card key={card} title={card} isBusy>
          <Skeleton lines={3} />
        </Card>
      ))}
    </PreviewLayout>
  );
  return (
    <WorkspacePage
      currentPage="captures"
      page={{
        topBar: <TopBar title={title} icon={icon} isLoading />,
        body:
          tabs === undefined ? (
            layout
          ) : (
            <Tabs
              label={tabs.label}
              variant="bar"
              tabs={tabs.items.map((each) => ({
                ...each,
                ...(each.id === tabs.shown ? {} : { isDisabled: true }),
              }))}
              selectedKey={tabs.shown}
            >
              <TabPanel id={tabs.shown} variant="fill">
                {layout}
              </TabPanel>
            </Tabs>
          ),
      }}
    />
  );
}
