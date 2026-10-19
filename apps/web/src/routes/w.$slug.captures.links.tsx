import { createFileRoute } from '@tanstack/react-router';
import { CapturePlaceholder } from '../features/captures/CapturePlaceholder.tsx';

// Captures › Links: the booking links. A placeholder until the booking lane moves its screen in.
export const Route = createFileRoute('/w/$slug/captures/links')({
  component: () => <CapturePlaceholder tab="links" />,
});
