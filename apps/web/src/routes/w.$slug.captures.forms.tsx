import { createFileRoute } from '@tanstack/react-router';
import { CapturePlaceholder } from '../features/captures/CapturePlaceholder.tsx';

// Captures › Forms: the lead capture forms. A placeholder until the forms lane moves its screen in.
export const Route = createFileRoute('/w/$slug/captures/forms')({
  component: () => <CapturePlaceholder tab="forms" />,
});
