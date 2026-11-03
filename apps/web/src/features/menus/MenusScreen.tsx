// Brief
// Purpose: the Menu app's editor (spec 0065, H1, AC-6520 to AC-6527), laid out after checklabs' menu editor: a header
// with the status and one Review and publish, the menus, then each menu's Structure (sections, sub sections and their
// dishes in order), Dishes, Options and Settings, with the guest menu's phone beside it.
// Main task: build a menu and publish it, watching the guest menu take shape in the phone beside it.
// Leaves out: the guest look's presets (H5), QR codes per table (H2, the Menu QR app), import (H6), analytics (0066).
import { isDataError, type MenuDraft, type MenuItem as Dish, type MenuStore, type PlaceHours } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  Menu,
  MenuItem,
  MenuTrigger,
  MenuList,
  Modal,
  PreviewLayout,
  SegmentedControl,
  Select,
  SetupChecklist,
  TabPanel,
  Tabs,
  TopBar,
  type Toasts,
} from '@crm/ui';
import { useEffect, useState } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { publicMenuUrl } from '../booking/links.ts';
import { businessSettingsHref, placeTablesHref } from '../settings/nav.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DishesTab } from './DishesTab.tsx';
import { GroupDrawer } from './GroupDrawer.tsx';
import { ItemDialog } from './ItemDialog.tsx';
import { OptionsTab } from './OptionsTab.tsx';
import { draftPhotoHref } from './photo.ts';
import {
  formatPreviewAt,
  parsePreviewAt,
  previewInstant,
  PREVIEW_DAYS,
  PREVIEW_TIMES,
  type PreviewAt,
} from './preview-at.ts';
import { previewMenu, publishBlocker, unpricedDishes } from './preview.ts';
import { PublishDialog } from './PublishDialog.tsx';
import { SectionDrawer } from './SectionDrawer.tsx';
import { SettingsTab } from './SettingsTab.tsx';
import { StructureTab } from './StructureTab.tsx';
import { strings } from './strings.ts';

/** The tabs of one menu, after checklabs' Structure and Items, its modifier groups and its Settings page. */
export const MENU_TABS = ['structure', 'dishes', 'options', 'settings'] as const;
/** One tab of a menu. */
export type MenuTab = (typeof MENU_TABS)[number];

/** What the screen opens over itself: a dish, a section or an option group in a drawer, or a confirm. */
export type Open =
  | { readonly kind: 'item'; readonly item?: Dish; readonly sectionId?: string; readonly newName?: string }
  | { readonly kind: 'section'; readonly menuId: string; readonly sectionId?: string; readonly parentId?: string }
  | { readonly kind: 'group'; readonly groupId?: string }
  | { readonly kind: 'discard' }
  | { readonly kind: 'publish' }
  | { readonly kind: 'deleteMenu'; readonly menuId: string; readonly name: string }
  | { readonly kind: 'deleteSection'; readonly sectionId: string; readonly name: string }
  | { readonly kind: 'deleteItem'; readonly item: Dish }
  | undefined;

/** Where the screen stands, kept in the address (`?menu=&tab=&at=&preview=`), so a reload or a link opens it there. */
export interface MenusView {
  readonly menu?: string;
  readonly tab?: MenuTab;
  /** `sat-11:00`: the preview read on Saturday at 11:00 at the place (`preview-at.ts`). */
  readonly at?: string;
  readonly preview?: 'off';
}

/** The address's search as the screen reads it: anything unknown is dropped. */
export function menusSearch(search: Record<string, unknown>): MenusView {
  const tab = search.tab;
  return {
    ...(typeof search.menu === 'string' && /^[0-9a-f-]{36}$/i.test(search.menu) ? { menu: search.menu } : {}),
    ...(typeof tab === 'string' && (MENU_TABS as readonly string[]).includes(tab) ? { tab: tab as MenuTab } : {}),
    ...(parsePreviewAt(search.at) === undefined ? {} : { at: search.at as string }),
    ...(search.preview === 'off' ? { preview: 'off' as const } : {}),
  };
}

export interface MenusScreenProps {
  readonly store: MenuStore;
  readonly slug: string;
  readonly toasts: Toasts;
  /** The business's name and each place's hours, for the preview's header, the checklist and serving defaults. */
  readonly business: { readonly name: string; readonly hours: Readonly<Record<string, PlaceHours>> };
  readonly view: MenusView;
}

/** The Menus screen (spec 0065, H1). */
export function MenusScreen({ store, slug, toasts, business, view }: MenusScreenProps) {
  const state = useHospitality(store.draft(slug));
  const [placeId, setPlaceId] = useState<string | undefined>();
  const [open, setOpen] = useState<Open>();
  const [justPublished, setJustPublished] = useState(false);
  const router = useRouter();
  const navigate = useNavigate();
  const go = (next: Partial<MenusView>) =>
    void navigate({
      to: '/w/$slug/menus',
      params: { slug },
      search: menusSearch({ ...view, ...next }),
      replace: true,
    });
  // "Published" stands in the button for two seconds after a publish, then it reads Review and publish again.
  useEffect(() => {
    if (!justPublished) return undefined;
    const timer = globalThis.setTimeout(() => setJustPublished(false), 2_000);
    return () => globalThis.clearTimeout(timer);
  }, [justPublished]);

  if (state.status === 'loading') {
    return (
      <WorkspacePage
        currentPage="menus"
        page={{
          topBar: <TopBar title={strings.title} isLoading />,
          body: <EmptyState title={strings.title} isLoading />,
        }}
      />
    );
  }
  if (state.status === 'error') {
    return (
      <WorkspacePage
        currentPage="menus"
        page={{
          topBar: <TopBar title={strings.title} />,
          body: (
            <EmptyState tone="error" title={strings.failed} onRetry={() => store.draft(slug).retry()}>
              {state.error.message}
            </EmptyState>
          ),
        }}
      />
    );
  }
  const draft = state.value;
  const said = (refused: { readonly message: string } | undefined) => {
    if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
  };
  const place = draft.places.find((each) => each.id === placeId) ?? draft.places[0];
  const placeHours = place === undefined ? undefined : business.hours[place.id];
  const menus = [...draft.menus].sort((a, b) => a.position - b.position);
  const current = menus.find((each) => each.id === view.menu) ?? menus[0];
  const tab: MenuTab = view.tab ?? 'structure';
  const blocker = publishBlocker(draft);
  const isLive = draft.publishedAt !== undefined;
  const unpriced = unpricedDishes(draft);
  const showsPreview = view.preview !== 'off';

  // The place's own page holds its week, so Set your hours opens there, not on the Business list (walk, 4 Nov).
  const hoursHref = place === undefined ? businessSettingsHref(slug) : placeTablesHref(slug, place.id);

  const copyLink = async (link: string) => {
    try {
      await globalThis.navigator.clipboard.writeText(link);
      toasts.toast({ tone: 'success', message: strings.linkCopied });
    } catch {
      toasts.toast({ tone: 'danger', message: link });
    }
  };

  // A first menu comes with a first section, so Add dishes is right there (foolproof from the first click).
  const newMenu = () => {
    const id = store.newId();
    const isFirst = draft.menus.length === 0;
    go({ menu: id, tab: 'structure' });
    void store
      .saveMenu(slug, {
        id,
        name: isFirst ? strings.newMenuName : `${strings.newMenu} ${String(draft.menus.length + 1)}`,
        placeIds: draft.places.map((each) => each.id),
      })
      .then((refused) => {
        said(refused);
        if (refused !== undefined) return;
        void store
          .saveSection(slug, { id: store.newId(), menuId: id, name: strings.newSectionName, layout: 'list' })
          .then(said);
      });
  };

  const hasHours = placeHours !== undefined && Object.values(placeHours.weekly).some((ranges) => ranges.length > 0);
  const steps = [
    {
      id: 'hours',
      title: strings.stepPlace,
      detail: hasHours ? strings.stepPlaceDone : strings.stepPlaceTodo,
      isDone: hasHours,
      action: strings.open,
    },
    { id: 'menu', title: strings.stepMenu, isDone: draft.menus.length > 0, action: strings.add },
    {
      id: 'items',
      title: strings.stepItems,
      isDone: draft.sections.some((section) => section.itemIds.length > 0),
      action: strings.add,
    },
    { id: 'publish', title: strings.stepPublish, detail: strings.stepPublishDetail, isDone: isLive },
    {
      id: 'share',
      title: strings.stepShare,
      detail: isLive ? strings.stepShareDetail : strings.stepShareLater,
      isDone: false,
      ...(isLive ? { action: strings.copyLink } : {}),
    },
  ];

  const actions =
    draft.menus.length === 0 && !isLive ? undefined : (
      <>
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.more} />
          <Menu
            label={strings.more}
            onAction={(key) => {
              if (place === undefined) return;
              if (key === 'open') globalThis.open(publicMenuUrl(place.menuKey), '_blank', 'noopener');
              else if (key === 'copy') void copyLink(publicMenuUrl(place.menuKey));
              else if (key === 'qr') setOpen({ kind: 'publish' });
              else if (key === 'discard') setOpen({ kind: 'discard' });
            }}
          >
            {isLive && place !== undefined ? (
              <>
                <MenuItem id="open" icon="external-link">
                  {strings.openGuest}
                </MenuItem>
                <MenuItem id="copy" icon="copy">
                  {strings.copyLink}
                </MenuItem>
                <MenuItem id="qr" icon="qr-code">
                  {strings.showQr}
                </MenuItem>
              </>
            ) : null}
            {draft.canEdit && isLive && draft.changes > 0 ? (
              <MenuItem id="discard" icon="undo-2">
                {strings.discard}
              </MenuItem>
            ) : null}
          </Menu>
        </MenuTrigger>
        {draft.canEdit ? (
          <Button
            variant="primary"
            animateLabel
            labelReserve={strings.reviewPublish}
            isDisabled={draft.changes === 0 && isLive}
            onPress={() => setOpen({ kind: 'publish' })}
          >
            {justPublished ? strings.published : strings.reviewPublish}
          </Button>
        ) : null}
      </>
    );

  const atView = parsePreviewAt(view.at);
  const at = atView === undefined || place === undefined ? undefined : previewInstant(atView, place.timeZone);
  const preview =
    place === undefined || !showsPreview || current === undefined ? undefined : (
      <>
        {/* The guests' own look (the Warm preset with the brand's accent), before any Publish. */}
        <link rel="stylesheet" href={`/api/menu/look.css?workspace=${encodeURIComponent(slug)}`} precedence="menu" />
        <MenuList
          menu={previewMenu(draft, place, {
            businessName: business.name,
            ...(placeHours === undefined ? {} : { hours: placeHours }),
          })}
          photoHref={(photoId, size, version) => draftPhotoHref(slug, photoId, size, version)}
          {...(at === undefined ? {} : { at: at.getTime() })}
        />
      </>
    );

  const previewControls =
    place === undefined || !showsPreview || current === undefined ? undefined : (
      <>
        {draft.places.length > 1 ? (
          <SegmentedControl
            label={strings.previewAt}
            segments={draft.places.map((each) => ({ value: each.id, label: each.name }))}
            value={place.id}
            onChange={setPlaceId}
          />
        ) : null}
        <Select
          label={strings.previewDay}
          items={[
            { id: 'now', label: strings.previewNow },
            ...PREVIEW_DAYS.map((day) => ({ id: day, label: strings.dayNames[day] })),
          ]}
          value={atView?.day ?? 'now'}
          onChange={(day) =>
            go({
              at:
                day === null || day === 'now' || !PREVIEW_DAYS.includes(day as PreviewAt['day'])
                  ? undefined
                  : formatPreviewAt({ day: day as PreviewAt['day'], time: atView?.time ?? '12:00' }),
            })
          }
        />
        {atView === undefined ? null : (
          <Select
            label={strings.previewTime}
            variant="time"
            items={PREVIEW_TIMES.map((time) => ({ id: time, label: time }))}
            value={atView.time}
            onChange={(time) => {
              if (time !== null) go({ at: formatPreviewAt({ day: atView.day, time }) });
            }}
          />
        )}
      </>
    );

  return (
    <WorkspacePage
      currentPage="menus"
      page={{
        topBar: (
          <TopBar
            title={strings.title}
            icon="utensils"
            meta={
              <Badge
                tone={isLive ? 'accent' : 'neutral'}
                text={`${isLive ? strings.statusLive : strings.statusDraft}${draft.changes > 0 && isLive ? ` · ${strings.changesShort(draft.changes)}` : ''}`}
              />
            }
          >
            {actions}
          </TopBar>
        ),
        body: (
          <>
            <PreviewLayout
              previewShare="wide"
              notices={
                !isLive ? (
                  <SetupChecklist
                    title={strings.setup}
                    steps={steps}
                    onAction={(id) => {
                      if (id === 'hours') router.history.push(hoursHref);
                      else if (id === 'menu') newMenu();
                      else if (id === 'share' && place !== undefined) void copyLink(publicMenuUrl(place.menuKey));
                      else if (id === 'items' && current !== undefined) {
                        const section = draft.sections.find((each) => each.menuId === current.id);
                        setOpen({ kind: 'item', ...(section === undefined ? {} : { sectionId: section.id }) });
                      }
                    }}
                  />
                ) : undefined
              }
              {...(preview === undefined ? {} : { preview })}
              {...(previewControls === undefined ? {} : { previewControls })}
            >
              {current === undefined ? (
                <EmptyState
                  icon="utensils"
                  title={strings.emptyMenus}
                  actions={
                    draft.canEdit ? (
                      <Button variant="primary" icon="plus" onPress={newMenu}>
                        {strings.newMenu}
                      </Button>
                    ) : undefined
                  }
                >
                  {strings.emptyMenusLine}
                </EmptyState>
              ) : (
                <Tabs
                  label={strings.menus}
                  tabs={menus.map((menu) => ({ id: menu.id, label: menu.name }))}
                  selectedKey={current.id}
                  onSelectionChange={(id) => go({ menu: id })}
                  end={
                    <>
                      {draft.canEdit && draft.menus.length < 30 ? (
                        <Button icon="plus" onPress={newMenu}>
                          {strings.newMenu}
                        </Button>
                      ) : null}
                    </>
                  }
                >
                  {menus.map((menu) => (
                    <TabPanel key={menu.id} id={menu.id}>
                      <Tabs
                        label={strings.menuSettings}
                        tabs={[
                          {
                            id: 'structure',
                            label: strings.tabStructure,
                            icon: 'list',
                            count: draft.sections.filter((each) => each.menuId === menu.id).length,
                          },
                          {
                            id: 'dishes',
                            label: strings.tabDishes,
                            icon: 'utensils',
                            count: draft.items.length,
                            ...(unpriced.length === 0 ? {} : { alert: strings.needsPrice(unpriced.length) }),
                          },
                          {
                            id: 'options',
                            label: strings.tabOptions,
                            icon: 'sliders-horizontal',
                            count: draft.groups.length,
                          },
                          { id: 'settings', label: strings.tabSettings, icon: 'settings' },
                        ]}
                        selectedKey={tab}
                        onSelectionChange={(id) =>
                          go({ tab: (MENU_TABS as readonly string[]).includes(id) ? (id as MenuTab) : 'structure' })
                        }
                      >
                        <TabPanel id="structure">
                          <StructureTab
                            store={store}
                            slug={slug}
                            draft={draft}
                            menuId={menu.id}
                            onOpen={setOpen}
                            said={said}
                            toasts={toasts}
                          />
                        </TabPanel>
                        <TabPanel id="dishes">
                          <DishesTab store={store} slug={slug} draft={draft} onOpen={setOpen} said={said} />
                        </TabPanel>
                        <TabPanel id="options">
                          <OptionsTab draft={draft} onOpen={setOpen} />
                        </TabPanel>
                        <TabPanel id="settings">
                          <SettingsTab
                            store={store}
                            slug={slug}
                            draft={draft}
                            menuId={menu.id}
                            {...(placeHours === undefined ? {} : { placeHours })}
                            onOpen={setOpen}
                            said={said}
                          />
                        </TabPanel>
                      </Tabs>
                    </TabPanel>
                  ))}
                </Tabs>
              )}
            </PreviewLayout>

            {open?.kind === 'item' ? (
              <ItemDialog
                store={store}
                slug={slug}
                draft={draft}
                {...(open.item === undefined ? {} : { item: open.item })}
                {...(open.sectionId === undefined ? {} : { sectionId: open.sectionId })}
                {...(open.newName === undefined ? {} : { newName: open.newName })}
                toasts={toasts}
                onClose={() => setOpen(undefined)}
              />
            ) : null}
            {open?.kind === 'section' ? (
              <SectionDrawer
                store={store}
                slug={slug}
                draft={draft}
                menuId={open.menuId}
                {...(open.sectionId === undefined ? {} : { sectionId: open.sectionId })}
                {...(open.parentId === undefined ? {} : { parentId: open.parentId })}
                {...(placeHours === undefined ? {} : { placeHours })}
                toasts={toasts}
                onClose={() => setOpen(undefined)}
              />
            ) : null}
            {open?.kind === 'group' ? (
              <GroupDrawer
                store={store}
                slug={slug}
                draft={draft}
                {...(open.groupId === undefined ? {} : { groupId: open.groupId })}
                toasts={toasts}
                onClose={() => setOpen(undefined)}
              />
            ) : null}
            {open?.kind === 'publish' ? (
              <PublishDialog
                store={store}
                slug={slug}
                draft={draft}
                hasHours={hasHours}
                {...(place === undefined ? {} : { place })}
                blocker={blocker}
                onClose={() => setOpen(undefined)}
                onPublished={() => setJustPublished(true)}
                onFix={(fix) => {
                  setOpen(undefined);
                  if (fix.kind === 'hours') router.history.push(hoursHref);
                  else if (fix.kind === 'item') {
                    const dish = draft.items.find((each) => each.id === fix.itemId);
                    if (dish !== undefined) setOpen({ kind: 'item', item: dish });
                  } else if (fix.kind === 'menu') go({ menu: fix.menuId, tab: 'settings' });
                  else go({ tab: 'structure' });
                }}
              />
            ) : null}
            <Modal
              variant="confirm"
              tone="danger"
              title={strings.discardQuestion}
              isOpen={open?.kind === 'discard'}
              onOpenChange={(isOpen) => {
                if (!isOpen) setOpen(undefined);
              }}
              actions={
                <>
                  <Button slot="close">{strings.keepEditing}</Button>
                  <Button
                    variant="danger-solid"
                    onPress={() => {
                      setOpen(undefined);
                      void store.discard(slug).then(said);
                    }}
                  >
                    {strings.discardChanges}
                  </Button>
                </>
              }
            >
              {strings.discardLine}
            </Modal>
            <Modal
              variant="confirm"
              tone="danger"
              title={open?.kind === 'deleteMenu' ? strings.deleteMenuQuestion(open.name) : strings.deleteMenu}
              isOpen={open?.kind === 'deleteMenu'}
              onOpenChange={(isOpen) => {
                if (!isOpen) setOpen(undefined);
              }}
              actions={
                <>
                  <Button slot="close">{strings.cancel}</Button>
                  <Button
                    variant="danger-solid"
                    onPress={() => {
                      if (open?.kind === 'deleteMenu') {
                        go({ menu: undefined, tab: undefined });
                        void store.deleteMenu(slug, open.menuId).then(said);
                      }
                      setOpen(undefined);
                    }}
                  >
                    {strings.deleteMenu}
                  </Button>
                </>
              }
            >
              {strings.deleteMenuLine}
            </Modal>
            <Modal
              variant="confirm"
              tone="danger"
              title={open?.kind === 'deleteSection' ? strings.deleteSectionQuestion(open.name) : strings.deleteSection}
              isOpen={open?.kind === 'deleteSection'}
              onOpenChange={(isOpen) => {
                if (!isOpen) setOpen(undefined);
              }}
              actions={
                <>
                  <Button slot="close">{strings.cancel}</Button>
                  <Button
                    variant="danger-solid"
                    onPress={() => {
                      if (open?.kind === 'deleteSection') void store.deleteSection(slug, open.sectionId).then(said);
                      setOpen(undefined);
                    }}
                  >
                    {strings.deleteSection}
                  </Button>
                </>
              }
            >
              {strings.deleteSectionLine}
            </Modal>
            <Modal
              variant="confirm"
              tone="danger"
              title={open?.kind === 'deleteItem' ? strings.deleteDishQuestion(open.item.name) : strings.deleteDish}
              isOpen={open?.kind === 'deleteItem'}
              onOpenChange={(isOpen) => {
                if (!isOpen) setOpen(undefined);
              }}
              actions={
                <>
                  <Button slot="close">{strings.cancel}</Button>
                  <Button
                    variant="danger-solid"
                    onPress={() => {
                      if (open?.kind === 'deleteItem') void store.deleteItem(slug, open.item.id).then(said);
                      setOpen(undefined);
                    }}
                  >
                    {strings.deleteDish}
                  </Button>
                </>
              }
            >
              {strings.deleteDishLine}
            </Modal>
            {isLive && place !== undefined && !showsPreview ? (
              <ButtonLink href={publicMenuUrl(place.menuKey)} isExternal icon="external-link">
                {strings.openGuest}
              </ButtonLink>
            ) : null}
          </>
        ),
      }}
    />
  );
}

/** Whether a refusal is the app gate's, for the route. */
export const isNotInstalled = (error: unknown): boolean =>
  isDataError(error) && (error.code === 'APP_NOT_INSTALLED' || error.code === 'NOT_FOUND');

/** The draft's count of changes, for tests. */
export const changesOf = (draft: MenuDraft): number => draft.changes;
