// Brief
// Purpose: the TopBar of Booking pages and of Forms, drawn once by each page's layout: the scheduling tile, the title, the count and New, as People's TopBar has.
// Main task: say how many booking pages or forms there are and make a new one, from one place that never moves while the list loads.
// Leaves out: the search bar and the list (the layout's bar and the page's screen).
import type { CaptureListView } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import { Badge, TopBar } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { SCHEDULING_HUE } from '../scheduling.ts';
import { CapturesNewButton } from './create.tsx';
import type { CapturePage } from './pages.ts';
import { strings } from './strings.ts';

/** Props for CapturesTopBar. */
export interface CapturesTopBarProps {
  readonly slug: string;
  /** Which list page: Booking pages (`links`) or Forms. */
  readonly page: CapturePage;
}

/** The TopBar: the tile, the page's title, how many it lists once the list is in, and New at the end. */
export function CapturesTopBar({ slug, page }: CapturesTopBarProps) {
  const { data } = useRouteContext({ from: '__root__' });
  return (
    <TopBar
      title={page === 'links' ? strings.linksTitle : strings.formsTitle}
      icon={page === 'links' ? 'link' : 'clipboard-list'}
      hue={SCHEDULING_HUE}
      meta={
        page === 'links' ? (
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

/** A list's count beside the title, once the list is in: the same held list the page's screen reads. */
function ListCount<Item>({ view, label }: { readonly view: CaptureListView<Item>; readonly label: string }) {
  const list = useCaptureList(view);
  if (list.status !== 'ready') return null;
  return <Badge count={list.items.length} max={Infinity} label={label} />;
}
