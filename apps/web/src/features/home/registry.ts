// Home's section registry (spec 0041): Home is an ordered list of sections,
// each one entry here. A section owns its own read (through the data layer),
// its loading, empty and error states, and its own visibility rule, so a new
// feature adds one entry and nothing else. Pure: no React, no data layer.
import type { HomeSectionKey, InvitationView, MemberView, ObjectSummary, Permission, TaskList } from '@crm/data';
import type { ComponentType } from 'react';

/** What Home knows before any section reads: the route loader's answers. Every section gets it. */
export interface HomeContext {
  readonly slug: string;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberView[];
  readonly meId: string | undefined;
  readonly permissions: readonly Permission[];
  /** My open tasks assigned to me (the list My tasks holds); undefined when it couldn't be opened. */
  readonly tasks: TaskList | undefined;
  /** Open invitations, read only for a member who may invite. */
  readonly invitations: readonly InvitationView[] | undefined;
}

/** What a section is drawn with: Home's context, and how to put itself away (when its entry allows it). */
export interface HomeSectionProps {
  readonly context: HomeContext;
  /** Puts this section away for the member (a member preference); undefined when it can't be hidden. */
  readonly onHide?: () => void;
}

/** One entry in Home's registry. */
export interface HomeSection {
  /** Its key: stable, and what a member's hidden list names (`setup`). */
  readonly id: HomeSectionKey;
  /** Its name, for the record (each section draws its own title). */
  readonly title: string;
  /** `full` runs across the page; `half` takes one of the grid's two columns (one on a phone). */
  readonly width: 'full' | 'half';
  /** Whether the member gets it at all: a feature or permission check, from what Home knows before reading. */
  readonly isVisible: (context: HomeContext) => boolean;
  /** Whether the member may put it away (its own menu or Dismiss). */
  readonly isHideable?: boolean;
  readonly Component: ComponentType<HomeSectionProps>;
}

/** The sections the member gets, in the registry's order: visible to them, and not put away. */
export function visibleSections<Section extends Pick<HomeSection, 'id' | 'isVisible' | 'isHideable'>>(
  sections: readonly Section[],
  context: HomeContext,
  hidden: readonly string[],
): readonly Section[] {
  return sections.filter(
    (section) => section.isVisible(context) && !(section.isHideable === true && hidden.includes(section.id)),
  );
}

/** A run of sections laid out together: full width ones alone, half width ones in a two column grid. */
export interface SectionRun<Section> {
  readonly key: string;
  readonly width: 'full' | 'half';
  readonly sections: readonly Section[];
}

/**
 * The sections in runs, keeping their order: each full one alone, each stretch of half ones in one grid. A stretch
 * with an odd count gives its last one the full width, so no card sits beside an empty column.
 */
export function sectionRuns<Section extends Pick<HomeSection, 'id' | 'width'>>(
  sections: readonly Section[],
): readonly SectionRun<Section>[] {
  const runs: SectionRun<Section>[] = [];
  for (const section of sections) {
    const last = runs.at(-1);
    if (section.width === 'half' && last?.width === 'half') {
      runs[runs.length - 1] = { ...last, sections: [...last.sections, section] };
    } else {
      runs.push({ key: section.id, width: section.width, sections: [section] });
    }
  }
  return runs.flatMap((run) => {
    const lone = run.sections.at(-1);
    if (run.width === 'full' || run.sections.length % 2 === 0 || lone === undefined) return [run];
    const paired = run.sections.slice(0, -1);
    const alone: SectionRun<Section> = { key: lone.id, width: 'full', sections: [lone] };
    return paired.length === 0 ? [alone] : [{ ...run, sections: paired }, alone];
  });
}

/** The member's hidden list with `id` added (each key once). */
export function withHidden(hidden: readonly string[], id: string): readonly string[] {
  return hidden.includes(id) ? hidden : [...hidden, id];
}
