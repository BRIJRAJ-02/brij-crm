import { createFileRoute, Outlet } from '@tanstack/react-router';
import { CapturesLayout } from '../features/captures/CapturesLayout.tsx';

// Scheduling › Forms (spec 0034, AC-928; Captures › Forms before, and `/captures/forms` redirects here): the
// layout, in People's chrome. The frame, the TopBar (the scheduling tile, the count and New) and the bar under it
// holding the search, with the list (`forms.index`) drawn below. The layout owns New and the search, so neither
// moves or remounts while the list loads. A form's editor and its preview sit outside it (`forms_.…`).
export const Route = createFileRoute('/w/$slug/forms')({
  component: FormsRoute,
});

function FormsRoute() {
  const { slug } = Route.useParams();
  return (
    <CapturesLayout slug={slug} page="forms">
      <Outlet />
    </CapturesLayout>
  );
}
