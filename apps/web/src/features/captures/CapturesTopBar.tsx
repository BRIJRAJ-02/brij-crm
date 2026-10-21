// Brief
// Purpose: the Captures TopBar, drawn once by the layout: the scheduling tile, the title, the chosen tab's count and New, as People's TopBar has.
// Main task: say how many links or forms there are and make a new one, from one place that never moves between tabs.
// Leaves out: the tab strip and the lists (the layout's tabs and each tab's screen).
import type { CaptureListView } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import { Badge, TopBar } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { SCHEDULING_HUE } from '../scheduling.ts';
import { CapturesNewButton } from './create.tsx';
import { strings } from './strings.ts';
import type { CaptureTab } from './tabs.ts';

/** Props for CapturesTopBar. */
export interface CapturesTopBarProps {
  readonly slug: string;
  readonly tab: CaptureTab;
}

/** Captures' TopBar: the tile, Captures, how many on the chosen tab once the list is in, and New at the end. */
export function CapturesTopBar({ slug, tab }: CapturesTopBarProps) {
  const { data } = useRouteContext({ from: '__root__' });
  return (
    <TopBar
      title={strings.title}
      icon="link"
      hue={SCHEDULING_HUE}
      meta={
        tab === 'links' ? (
          <ListCount key="links" view={data.bookingPages.view(slug)} label={strings.linksCount} />
        ) : (
          <ListCount key="forms" view={data.forms.view(slug)} label={strings.formsCount} />
        )
      }
    >
      <CapturesNewButton />
    </TopBar>
  );
}

/** A list's count beside the title, once the list is in: the same held list the tab's screen reads. */
function ListCount<Item>({ view, label }: { readonly view: CaptureListView<Item>; readonly label: string }) {
  const list = useCaptureList(view);
  if (list.status !== 'ready') return null;
  return <Badge count={list.items.length} max={Infinity} label={label} />;
}
