// Brief
// Purpose: the main sidebar's sections in the member's order (spec 0034): Favourites, Records, Lists and Scheduling.
// Main task: go to a favourite, an object or a Scheduling page; fold and open a section, kept for the member on every device.
// Leaves out: the workspace menu and the pages above the sections (the frame's), and the foot (Trash, Settings, Help).
import type { DataLayer, NavEntry, NavFavourite, NavState, NavUniverse, ObjectSummary } from '@crm/data';
import { navKey } from '@crm/data/navigation';
import { NavItem, NavSection } from '@crm/ui';
import { recordHref } from '../records/details.ts';
import { objectHref, viewHref } from './objects.ts';
import { drawnSections, PAGE_LINKS, type SidebarPage } from './sidebar.ts';
import { strings } from './strings.ts';

/** Props for SidebarSections. */
export interface SidebarSectionsProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The member's sidebar, with their changes waiting for an answer already applied. */
  readonly nav: NavState;
  readonly universe: NavUniverse;
  /** The workspace's objects; undefined while they load (Records shows skeleton rows). */
  readonly objects: readonly ObjectSummary[] | undefined;
  /** The `apiSlug` of the object whose page is open. */
  readonly currentObject?: string;
  readonly currentPage?: SidebarPage;
}

/** The sections in the member's order, each folding from its label, the fold kept for the member (AC-931). */
export function SidebarSections({
  data,
  slug,
  nav,
  universe,
  objects,
  currentObject,
  currentPage,
}: SidebarSectionsProps) {
  const objectOf = new Map((objects ?? []).map((object) => [object.id, object]));
  const favouriteOf = new Map(nav.favourites.map((favourite) => [navKey(favourite), favourite]));
  const context: ItemContext = { slug, objectOf, favouriteOf, currentObject, currentPage };
  return (
    <>
      {drawnSections(nav, universe).map((section) => (
        <NavSection
          key={section.key}
          title={section.title}
          isLoading={section.key === 'records' && objects === undefined}
          {...(section.key === 'records' ? { emptyLabel: strings.noObjects } : {})}
          isFolded={section.isFolded}
          onFoldChange={(isFolded) => {
            data.nav.change(slug, { op: 'fold', section: section.key, folded: isFolded }, universe);
          }}
        >
          {section.entries.filter((entry) => !entry.hidden).flatMap((entry) => itemOf(entry, context))}
        </NavSection>
      ))}
    </>
  );
}

/** What an item needs to draw itself. */
interface ItemContext {
  readonly slug: string;
  readonly objectOf: ReadonlyMap<string, ObjectSummary>;
  readonly favouriteOf: ReadonlyMap<string, NavFavourite>;
  readonly currentObject: string | undefined;
  readonly currentPage: SidebarPage | undefined;
}

/** One entry as its NavItem: an object, a Scheduling page, or a favourite view or record; nothing it can't draw. */
function itemOf(entry: NavEntry, { slug, objectOf, favouriteOf, currentObject, currentPage }: ItemContext) {
  const key = navKey(entry);
  if (entry.kind === 'object') {
    const object = objectOf.get(entry.id);
    if (object === undefined) return [];
    return [
      <NavItem
        key={key}
        icon={object.icon}
        hue={object.hue}
        href={objectHref(slug, object)}
        isCurrent={object.apiSlug === currentObject}
      >
        {object.pluralName}
      </NavItem>,
    ];
  }
  if (entry.kind === 'page') {
    const page = PAGE_LINKS[entry.id as keyof typeof PAGE_LINKS];
    if (page === undefined) return [];
    return [
      <NavItem key={key} icon={page.icon} href={page.href(slug)} isCurrent={currentPage === entry.id}>
        {page.label}
      </NavItem>,
    ];
  }
  if (entry.kind === 'view' || entry.kind === 'record') {
    const favourite = favouriteOf.get(key);
    if (favourite === undefined) return [];
    const name = favourite.label === '' ? strings.unnamedRecord(favourite.objectSingularName) : favourite.label;
    return [
      <NavItem
        key={key}
        icon={favourite.icon}
        hue={favourite.hue}
        href={
          favourite.kind === 'view'
            ? viewHref(slug, favourite.objectSlug, favourite.id)
            : recordHref(slug, favourite.objectSlug, favourite.id)
        }
        // A view says which object it shows; a record's name beside its object's tile is enough (AC-925).
        {...(favourite.kind === 'view' ? { meta: favourite.objectName } : {})}
      >
        {name}
      </NavItem>,
    ];
  }
  // Lists (#51) have no page yet: nothing to draw.
  return [];
}
