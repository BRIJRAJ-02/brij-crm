// Home's sections, in the order Home shows them (spec 0041). A new feature
// adds one entry here: its key, its width, who gets it, and its component,
// which reads its own data and draws its own loading, empty and error states.
//
// Home shows two cards, Today and Your link page (the owner, 27 October 2026), with Finish setting up above them
// while a workspace still has steps left. My tasks, Recently viewed, New captures, Team today and This week came off;
// their components are still in sections/, so bringing one back is putting its entry back here.
import type { HomeSection } from './registry.ts';
import { homeStrings as linkPageStrings } from '../link-page/home-strings.ts';
import { LinkPageSection } from './sections/LinkPageSection.tsx';
import { SetupSection } from './sections/SetupSection.tsx';
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
