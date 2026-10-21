import { createFileRoute } from '@tanstack/react-router';
import { HomeScreen } from '../features/home/HomeScreen.tsx';

// Home (owner, 21 October 2026): where a workspace opens, the sidebar's first row. A placeholder until the Home
// dashboard lane ports timefix's dashboard module.
export const Route = createFileRoute('/w/$slug/home')({
  component: HomeScreen,
});
