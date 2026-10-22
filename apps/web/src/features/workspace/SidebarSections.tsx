// Brief
// Purpose: the main sidebar's sections in the member's order (spec 0034): Favourites, Records, Lists and Scheduling.
// Main task: go to a favourite, an object or a Scheduling page; fold, reorder and hide, and remove a favourite, each kept for the member on every device.
// Leaves out: the workspace menu and the pages above the sections (the frame's), and the foot (Trash, Settings, Help).
import type {
  DataLayer,
  NavEntry,
  NavFavourite,
  NavOperation,
  NavSectionKey,
  NavState,
  NavUniverse,
  ObjectSummary,
} from '@crm/data';
import { moveIndexFor, navKey, sectionOrder } from '@crm/data/navigation';
import { Menu, MenuItem, NavGroup, NavItem, NavSection } from '@crm/ui';
import { recordHref } from '../records/details.ts';
import { objectHref, viewHref } from './objects.ts';
import { drawnSections, PAGE_LINKS, prefsOf, sectionMoveIndex, type SidebarPage } from './sidebar.ts';
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
  /** Opens the Customise sidebar dialog. */
  readonly onCustomise: () => void;
}

/**
 * The sections in the member's order (AC-931, AC-932, AC-933): each folds from its label, moves by its grip or its
 * menu (Move up, Move down, Customise sidebar), and its items reorder by their grips and hide or leave the
 * favourites from their menus, each change kept for the member.
 */
export function SidebarSections({
  data,
  slug,
  nav,
  universe,
  objects,
  currentObject,
  currentPage,
  onCustomise,
}: SidebarSectionsProps) {
  const change = (op: NavOperation) => {
    void data.nav.change(slug, op, universe);
  };
  const objectOf = new Map((objects ?? []).map((object) => [object.id, object]));
  const favouriteOf = new Map(nav.favourites.map((favourite) => [navKey(favourite), favourite]));
  const context: ItemContext = { slug, objectOf, favouriteOf, currentObject, currentPage, change };
  const sections = drawnSections(nav, universe);
  const order = sectionOrder(prefsOf(nav));
  const drawn = sections.map((section) => section.key);
  const moveSection = (key: NavSectionKey, visibleIndex: number) => {
    change({ op: 'moveSection', section: key, toIndex: sectionMoveIndex(order, drawn, key, visibleIndex) });
  };
  return (
    <>
      {sections.map((section, index) =>
        // Bookings and Captures sit as round 6 had them, a group with no label, fold or menu on screen (the owner,
        // 22 October 2026: "keep the sidebar like this"); the label names the group for screen readers.
        section.key === 'scheduling' ? (
          <NavGroup key={section.key} label={section.title}>
            {section.entries.filter((entry) => !entry.hidden).flatMap((entry) => itemOf(entry, context))}
          </NavGroup>
        ) : (
          <NavSection
            key={section.key}
            title={section.title}
            isLoading={section.key === 'records' && objects === undefined}
            {...(section.key === 'records' ? { emptyLabel: strings.noObjects } : {})}
            isFolded={section.isFolded}
            onFoldChange={(isFolded) => {
              change({ op: 'fold', section: section.key, folded: isFolded });
            }}
            position={{ index, count: sections.length }}
            onMoveSection={(toIndex) => {
              moveSection(section.key, toIndex);
            }}
            menu={
              <Menu
                label={strings.sectionOptions(section.title)}
                onAction={(key) => {
                  if (key === 'up') moveSection(section.key, index - 1);
                  if (key === 'down') moveSection(section.key, index + 1);
                  if (key === 'customise') onCustomise();
                }}
              >
                {/* Only the moves there is room for: the first has no Move up, the last no Move down. */}
                {index > 0 && (
                  <MenuItem id="up" icon="arrow-up">
                    {strings.moveUp}
                  </MenuItem>
                )}
                {index < sections.length - 1 && (
                  <MenuItem id="down" icon="arrow-down">
                    {strings.moveDown}
                  </MenuItem>
                )}
                <MenuItem id="customise" icon="sliders-horizontal">
                  {strings.customiseSidebar}
                </MenuItem>
              </Menu>
            }
            onReorder={(id, visibleIndex) => {
              const entry = section.entries.find((each) => navKey(each) === id);
              if (entry === undefined) return;
              change({
                op: 'move',
                kind: entry.kind,
                id: entry.id,
                toIndex: moveIndexFor(section.entries, id, visibleIndex),
              });
            }}
          >
            {section.entries.filter((entry) => !entry.hidden).flatMap((entry) => itemOf(entry, context))}
          </NavSection>
        ),
      )}
    </>
  );
}

/** An item's one menu: Hide from sidebar for a page or an object, Remove from favourites for a favourite. */
export function itemMenu(name: string, label: string, onAction: () => void) {
  return (
    <Menu label={strings.itemOptions(name)} onAction={onAction}>
      <MenuItem id="act">{label}</MenuItem>
    </Menu>
  );
}

/** What an item needs to draw itself. */
interface ItemContext {
  readonly slug: string;
  readonly objectOf: ReadonlyMap<string, ObjectSummary>;
  readonly favouriteOf: ReadonlyMap<string, NavFavourite>;
  readonly currentObject: string | undefined;
  readonly currentPage: SidebarPage | undefined;
  readonly change: (op: NavOperation) => void;
}

/** One entry as its NavItem: an object, a Scheduling page, or a favourite view or record; nothing it can't draw. */
function itemOf(entry: NavEntry, { slug, objectOf, favouriteOf, currentObject, currentPage, change }: ItemContext) {
  const key = navKey(entry);
  const hide = () => {
    change({ op: 'hide', kind: entry.kind, id: entry.id });
  };
  if (entry.kind === 'object') {
    const object = objectOf.get(entry.id);
    if (object === undefined) return [];
    return [
      <NavItem
        key={key}
        id={key}
        icon={object.icon}
        hue={object.hue}
        href={objectHref(slug, object)}
        isCurrent={object.apiSlug === currentObject}
        menu={itemMenu(object.pluralName, strings.hideFromSidebar, hide)}
      >
        {object.pluralName}
      </NavItem>,
    ];
  }
  if (entry.kind === 'page') {
    const page = PAGE_LINKS[entry.id as keyof typeof PAGE_LINKS];
    if (page === undefined) return [];
    return [
      <NavItem
        key={key}
        id={key}
        icon={page.icon}
        href={page.href(slug)}
        isCurrent={currentPage === entry.id}
        menu={itemMenu(page.label, strings.hideFromSidebar, hide)}
      >
        {page.label}
      </NavItem>,
    ];
  }
  if (entry.kind === 'view' || entry.kind === 'record') {
    const favourite = favouriteOf.get(key);
    if (favourite === undefined) return [];
    const name = favourite.label === '' ? strings.unnamedRecord(favourite.objectSingularName) : favourite.label;
    const unstar = () => {
      change({ op: 'unstar', kind: favourite.kind, id: favourite.id });
    };
    return [
      <NavItem
        key={key}
        id={key}
        menu={itemMenu(name, strings.removeFavourite, unstar)}
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
