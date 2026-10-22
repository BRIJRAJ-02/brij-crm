// Home's sections, in the order Home shows them (spec 0041). A new feature
// adds one entry here: its key, its width, who gets it, and its component,
// which reads its own data and draws its own loading, empty and error states.
import type { HomeSection } from './registry.ts';
import { CapturesSection } from './sections/CapturesSection.tsx';
import { MetricsSection } from './sections/MetricsSection.tsx';
import { RecentSection } from './sections/RecentSection.tsx';
import { SetupSection } from './sections/SetupSection.tsx';
import { TasksSection } from './sections/TasksSection.tsx';
import { TeamSection } from './sections/TeamSection.tsx';
import { TodaySection } from './sections/TodaySection.tsx';

/** Home's registry. */
export const HOME_SECTIONS: readonly HomeSection[] = [
  {
    id: 'setup',
    title: 'Finish setting up',
    width: 'full',
    // Each step is left out for a member who may not take it; with none left, the section draws nothing.
    isVisible: () => true,
    isHideable: true,
    Component: SetupSection,
  },
  { id: 'today', title: 'Today', width: 'half', isVisible: () => true, Component: TodaySection },
  { id: 'tasks', title: 'My tasks', width: 'half', isVisible: () => true, Component: TasksSection },
  { id: 'recent', title: 'Recently viewed', width: 'half', isVisible: () => true, Component: RecentSection },
  {
    id: 'captures',
    title: 'New captures',
    width: 'half',
    isVisible: ({ permissions }) => permissions.includes('forms.manage'),
    Component: CapturesSection,
  },
  {
    id: 'team',
    title: 'Team today',
    width: 'half',
    // One member is not a team, and the read is behind Bookings.
    isVisible: ({ members, permissions }) => members.length > 1 && permissions.includes('booking.manage'),
    Component: TeamSection,
  },
  { id: 'metrics', title: 'This week', width: 'full', isVisible: () => true, Component: MetricsSection },
];
