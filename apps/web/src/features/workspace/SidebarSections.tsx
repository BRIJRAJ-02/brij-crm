// Brief
// Purpose: the main sidebar's sections in the member's order (spec 0034): Records, Lists and Scheduling.
// Main task: go to an object, a list or a Scheduling page, or make a list from Lists' "+" (spec 0048); fold, reorder and hide (with Undo), each kept for the member on every device.
// Leaves out: the workspace menu and the pages above the sections (the frame's), the foot (Trash, Settings, Help), and
// Favourites (no longer drawn, owner 30 October 2026).
import type {
  DataLayer,
  ListView,
  NavEntry,
  NavOperation,
  NavSectionKey,
  NavState,
  NavUniverse,
  ObjectSummary,
} from '@crm/data';
import { moveIndexFor, navKey, sectionOrder } from '@crm/data/navigation';
import { Menu, MenuItem, NavGroup, NavItem, NavSection, type Toasts } from '@crm/ui';
import { useLocation } from '@tanstack/react-router';
import { objectHref } from './objects.ts';
import { listHref } from '../lists/paths.ts';
import { strings as listStrings } from '../lists/strings.ts';
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
  /** The lists the member may read (spec 0048): the Lists section's items. */
  readonly lists?: readonly ListView[];
  /** New list, for whoever may make one: the "+" on the Lists label (AC-4801). */
  readonly onNewList?: () => void;
  /** The `apiSlug` of the object whose page is open. */
  readonly currentObject?: string;
  readonly currentPage?: SidebarPage;
  /** For Hide from sidebar's toast, whose Undo shows the object again. */
  readonly toasts: Toasts;
  /** Opens the Customise sidebar dialog. */
  readonly onCustomise: () => void;
}

/**
 * The sections in the member's order (AC-931, AC-932, AC-933): each folds from its label, moves by its grip or its
 * menu (Move up, Move down, Customise sidebar), and its items reorder by their grips and hide from their menus,
 * each change kept for the member.
 */
export function SidebarSections({
  data,
  slug,
  nav,
  universe,
  objects,
  lists = [],
  onNewList,
  currentObject,
  currentPage,
  toasts,
  onCustomise,
}: SidebarSectionsProps) {
  const change = (op: NavOperation) => {
    void data.nav.change(slug, op, universe);
  };
  // Hiding an object asked nothing and only Customise brought it back: the toast says where it went, with Undo.
  const hideObject = (object: ObjectSummary) => {
    change({ op: 'hide', kind: 'object', id: object.id });
    toasts.toast({
      tone: 'success',
      message: strings.hiddenFromSidebar(object.pluralName),
      action: {
        label: strings.undo,
        onAction: () => {
          change({ op: 'show', kind: 'object', id: object.id });
        },
      },
    });
  };
  const objectOf = new Map((objects ?? []).map((object) => [object.id, object]));
  const listOf = new Map(lists.map((list) => [list.id, list]));
  // Hiding a list says where it went, with Undo, as an object's does.
  const hideList = (list: ListView) => {
    change({ op: 'hide', kind: 'list', id: list.id });
    toasts.toast({
      tone: 'success',
      message: listStrings.hidden(list.name),
      action: {
        label: listStrings.undo,
        onAction: () => {
          change({ op: 'show', kind: 'list', id: list.id });
        },
      },
    });
  };
  // The open list (spec 0048): its address names it, as an object's page names its object.
  const path = useLocation({ select: (location) => location.pathname });
  const currentList = lists.find((list) => {
    const href = listHref(slug, list);
    return path === href || path.startsWith(`${href}/`);
  })?.id;
  const context: ItemContext = {
    slug,
    objectOf,
    listOf,
    currentObject,
    currentList,
    currentPage,
    change,
    hideObject,
    hideList,
  };
  const sections = drawnSections(nav, universe, onNewList !== undefined);
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
            {...(section.key === 'lists' ? { emptyLabel: listStrings.noLists } : {})}
            {...(section.key === 'lists' && onNewList !== undefined
              ? { add: { label: listStrings.newList, onAdd: onNewList } }
              : {})}
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

/** An item's one menu: Hide from sidebar for a page or an object. */
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
  readonly listOf: ReadonlyMap<string, ListView>;
  readonly currentObject: string | undefined;
  readonly currentList: string | undefined;
  readonly currentPage: SidebarPage | undefined;
  readonly change: (op: NavOperation) => void;
  readonly hideObject: (object: ObjectSummary) => void;
  readonly hideList: (list: ListView) => void;
}

/** One entry as its NavItem: an object or a Scheduling page; nothing it can't draw. */
function itemOf(
  entry: NavEntry,
  { slug, objectOf, listOf, currentObject, currentList, currentPage, change, hideObject, hideList }: ItemContext,
) {
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
        menu={itemMenu(object.pluralName, strings.hideFromSidebar, () => {
          hideObject(object);
        })}
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
  if (entry.kind === 'list') {
    const list = listOf.get(entry.id);
    if (list === undefined) return [];
    return [
      <NavItem
        key={key}
        id={key}
        icon={list.icon}
        hue={list.hue}
        href={listHref(slug, list)}
        isCurrent={list.id === currentList}
        menu={itemMenu(list.name, strings.hideFromSidebar, () => {
          hideList(list);
        })}
      >
        {list.name}
      </NavItem>,
    ];
  }
  // Views and records (the favourites, which `drawnSections` leaves out) aren't drawn.
  return [];
}
