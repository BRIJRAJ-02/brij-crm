// Brief
// Purpose: the Customise sidebar dialog for the open workspace (spec 0034, AC-933), from a section's menu or Settings › Preferences.
// Main task: show or hide each page, object and list, or reset the sidebar to its default after a confirm.
// Leaves out: the order (the sidebar's grips); it loads lazily, outside the first load.
import type { DataLayer, ListView, NavEntry, NavState, ObjectSummary } from '@crm/data';
import { navKey } from '@crm/data/navigation';
import { CustomiseSidebar, type CustomiseSidebarItem, type CustomiseSidebarSection } from '@crm/ui';
import { drawnSections, PAGE_LINKS, topEntries, universeOf } from './sidebar.ts';
import { strings } from './strings.ts';

/** Props for CustomiseSidebarDialog. */
export interface CustomiseSidebarDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly nav: NavState;
  readonly objects: readonly ObjectSummary[] | undefined;
  /** The lists the member may read (spec 0048): Lists' rows. */
  readonly lists?: readonly ListView[] | undefined;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/** The library's dialog over the member's sidebar: every switch is one optimistic change. */
export function CustomiseSidebarDialog({
  data,
  slug,
  nav,
  objects,
  lists = [],
  isOpen,
  onOpenChange,
}: CustomiseSidebarDialogProps) {
  const universe = universeOf(objects, nav, lists);
  const objectOf = new Map((objects ?? []).map((object) => [object.id, object]));
  const listOf = new Map(lists.map((list) => [list.id, list]));
  const rowOf = (entry: NavEntry): CustomiseSidebarItem[] => {
    if (entry.kind === 'object') {
      const object = objectOf.get(entry.id);
      return object === undefined
        ? []
        : [{ id: navKey(entry), name: object.pluralName, icon: object.icon, hue: object.hue, isShown: !entry.hidden }];
    }
    if (entry.kind === 'list') {
      const list = listOf.get(entry.id);
      return list === undefined
        ? []
        : [{ id: navKey(entry), name: list.name, icon: list.icon, hue: list.hue, isShown: !entry.hidden }];
    }
    if (entry.kind === 'page') {
      const page = PAGE_LINKS[entry.id as keyof typeof PAGE_LINKS];
      return page === undefined
        ? []
        : [{ id: navKey(entry), name: page.label, icon: page.icon, isShown: !entry.hidden }];
    }
    return [];
  };
  // Your work (Tasks), then each section drawn in the member's order; a section with nothing to switch is left out.
  const top: CustomiseSidebarSection = {
    id: 'top',
    title: strings.yourWork,
    items: topEntries(nav, universe).flatMap(rowOf),
  };
  const sections: CustomiseSidebarSection[] = [
    top,
    ...drawnSections(nav, universe).map((section) => ({
      id: section.key,
      title: section.title,
      items: section.entries.flatMap(rowOf),
    })),
  ].filter((section) => section.items.length > 0);
  return (
    <CustomiseSidebar
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      sections={sections}
      onShownChange={(_section, itemId, isShown) => {
        const [kind, ...rest] = itemId.split(':');
        const id = rest.join(':');
        if (kind !== 'object' && kind !== 'page' && kind !== 'list') return;
        void data.nav.change(slug, { op: isShown ? 'show' : 'hide', kind, id }, universe);
      }}
      // The confirm waits for the reset to land and says a refusal itself.
      onReset={() => data.nav.change(slug, { op: 'reset' }, universe, { isSaidHere: true })}
    />
  );
}
