// Home's sections, in the order Home shows them (spec 0041). A new feature
// adds one entry here: its key, its width, who gets it, and its component,
// which reads its own data and draws its own loading, empty and error states.
//
// Home shows two cards, Today and Your link page, and nothing else (the owner, 27 October 2026). Finish setting up,
// My tasks, Recently viewed, New captures, Team today and This week came off, and their components were deleted
// (31 October 2026); their pure helpers (setup.ts, team.ts, captures.ts, metrics.ts, due.ts) stay, with their tests.
import type { HomeSection } from './registry.ts';
import { homeStrings as linkPageStrings } from '../link-page/home-strings.ts';
import { LinkPageSection } from './sections/LinkPageSection.tsx';
import { TodaySection } from './sections/TodaySection.tsx';

/** Home's registry. */
export const HOME_SECTIONS: readonly HomeSection[] = [
  { id: 'today', title: 'Today', width: 'half', isVisible: () => true, Component: TodaySection },
  {
    id: 'linkPage',
    title: linkPageStrings.title,
    width: 'half',
    // Everyone has a link page once they claim a handle; before, the card says how (AC-5123).
    isVisible: () => true,
    isHideable: true,
    Component: LinkPageSection,
  },
];
