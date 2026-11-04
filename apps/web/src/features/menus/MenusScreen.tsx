// Brief
// Purpose: the Menu app's editor (spec 0065, H1, AC-6520 to AC-6527), laid out after checklabs' menu editor: a header
// with the menu picked, its status, Settings and one Publish, then the menu's Structure (sections, sub sections and their
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
  MenuSection,
  Modal,
  PreviewLayout,
  SegmentedControl,
  Select,
  SetupChecklist,
  TabPanel,
  Tabs,
  ToggleButton,
  TopBar,
  type Toasts,
} from '@crm/ui';
import { useEffect, useState } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { publicMenuUrl } from '../booking/links.ts';
import { useIsNarrow } from './narrow.ts';
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
import { MENU_TABS, menusSearch, type MenuTab, type MenusView } from './search.ts';
import { strings } from './strings.ts';

export { MENU_TABS, menusSearch, type MenuTab, type MenusView } from './search.ts';

/** What the screen opens over itself: a dish, a section or an option group in a drawer, or a confirm. */
export type Open =
  | { readonly kind: 'item'; readonly item?: Dish; readonly sectionId?: string; readonly newName?: string }
  | { readonly kind: 'section'; readonly menuId: string; readonly sectionId?: string; readonly parentId?: string }
  | { readonly kind: 'group'; readonly groupId?: string }
  | { readonly kind: 'discard' }
  | { readonly kind: 'publish' }
  | { readonly kind: 'hide' }
  | { readonly kind: 'deleteMenu'; readonly menuId: string; readonly name: string }
  | { readonly kind: 'deleteSection'; readonly sectionId: string; readonly name: string }
  | { readonly kind: 'deleteItem'; readonly item: Dish }
  | undefined;

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
  const isNarrow = useIsNarrow();
  // Put away from its own menu, the setup checklist stays away in this browser (UI state, never the server's).
  const setupKey = `crm.menus.setup-hidden.${slug}`;
  const [isSetupHidden, setSetupHidden] = useState(() => {
    try {
      return globalThis.localStorage.getItem(setupKey) === '1';
    } catch {
      return false;
    }
  });
  const hideSetup = () => {
    setSetupHidden(true);
    try {
      globalThis.localStorage.setItem(setupKey, '1');
    } catch {
      // Blocked storage: hidden for this visit.
    }
  };
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
    {
      id: 'publish',
      title: strings.stepPublish,
      detail: strings.stepPublishDetail,
      isDone: isLive,
      ...(draft.canEdit ? { action: strings.reviewStep } : {}),
    },
  ];

  // Live or Hidden (after checklabs' menu switch): hiding asks first, showing again is at once.
  const setHidden = (hidden: boolean) =>
    void store.setHidden(slug, hidden).then((refused) => {
      if (refused !== undefined) said(refused);
      else
        toasts.toast({ tone: hidden ? 'info' : 'success', message: hidden ? strings.hiddenToast : strings.shownToast });
    });
  const statusText = !isLive ? strings.statusDraft : draft.hidden ? strings.statusHidden : strings.statusLive;
  // The menu being edited, picked in the header beside the title (checklabs' editor names its menu there): the menus
  // to choose from, then New menu as an action of its own (a menu, as the saved view switcher, not a listbox value).
  const picker =
    current === undefined ? null : (
      <MenuTrigger>
        <Button variant="ghost" iconRight="chevron-down" label={strings.menuPicker}>
          {current.name}
        </Button>
        <Menu label={strings.menuPicker} onAction={(key) => (key === 'new' ? newMenu() : undefined)}>
          <MenuSection
            label={strings.menuList}
            isLabelHidden
            selectionMode="single"
            selectedKeys={[current.id]}
            onSelectionChange={(keys) => {
              const [id] = [...keys];
              if (id !== undefined && id !== current.id) go({ menu: String(id) });
            }}
          >
            {menus.map((menu) => (
              <MenuItem key={menu.id} id={menu.id}>
                {menu.name}
              </MenuItem>
            ))}
          </MenuSection>
          {draft.canEdit && draft.menus.length < 30 ? (
            <MenuSection label={strings.newMenu} isLabelHidden>
              <MenuItem id="new" icon="plus">
                {strings.newMenu}
              </MenuItem>
            </MenuSection>
          ) : null}
        </Menu>
      </MenuTrigger>
    );
  const status =
    isLive && draft.canEdit ? (
      <>
        {picker}
        <MenuTrigger>
          <Button variant="ghost" icon={draft.hidden ? 'eye-off' : 'eye'} iconRight="chevron-down">
            {statusText}
          </Button>
          <Menu
            label={strings.visibility}
            selectionMode="single"
            selectedKeys={[draft.hidden ? 'hidden' : 'live']}
            onSelectionChange={(keys) => {
              if (keys.has('hidden') && !draft.hidden) setOpen({ kind: 'hide' });
              else if (keys.has('live') && draft.hidden) setHidden(false);
            }}
          >
            <MenuItem id="live" icon="eye" description={strings.visibilityLive}>
              {strings.statusLive}
            </MenuItem>
            <MenuItem id="hidden" icon="eye-off" description={strings.visibilityHidden}>
              {strings.statusHidden}
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </>
    ) : (
      <>
        {picker}
        {/* At a phone's width a draft's badge gives its room to the menu picker; Publish says the rest. */}
        {isNarrow && !isLive ? null : <Badge tone={isLive && !draft.hidden ? 'accent' : 'neutral'} text={statusText} />}
      </>
    );

  const actions =
    draft.menus.length === 0 && !isLive ? undefined : (
      <>
        {/* Settings in the header, as checklabs' editor has it; its view keeps `?tab=settings`. */}
        {current === undefined ? null : (
          <ToggleButton
            variant="ghost"
            icon="settings"
            {...(isNarrow ? { label: strings.tabSettings } : { children: strings.tabSettings })}
            isSelected={tab === 'settings'}
            onChange={(isOn) => go({ tab: isOn ? 'settings' : 'structure' })}
          />
        )}
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.more} />
          <Menu
            label={strings.more}
            onAction={(key) => {
              if (key === 'new') {
                newMenu();
                return;
              }
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
            labelReserve={isNarrow ? strings.published : strings.reviewPublish}
            isDisabled={draft.changes === 0 && isLive}
            onPress={() => setOpen({ kind: 'publish' })}
          >
            {justPublished
              ? strings.published
              : isNarrow
                ? strings.publish
                : isLive && draft.changes > 0
                  ? strings.publishCount(draft.changes)
                  : strings.reviewPublish}
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
          <TopBar title={strings.title} {...(isNarrow ? {} : { icon: 'utensils' as const })} meta={status}>
            {actions}
          </TopBar>
        ),
        body: (
          <>
            <PreviewLayout
              previewShare="wide"
              notices={
                !isLive && !isSetupHidden ? (
                  <SetupChecklist
                    title={strings.setup}
                    steps={steps}
                    onHide={hideSetup}
                    onAction={(id) => {
                      if (id === 'hours') router.history.push(hoursHref);
                      else if (id === 'menu') newMenu();
                      else if (id === 'publish') setOpen({ kind: 'publish' });
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
              ) : tab === 'settings' ? (
                <>
                  <span>
                    <Button variant="ghost" icon="arrow-left" onPress={() => go({ tab: 'structure' })}>
                      {strings.backToMenu}
                    </Button>
                  </span>
                  <SettingsTab
                    store={store}
                    slug={slug}
                    draft={draft}
                    menuId={current.id}
                    {...(placeHours === undefined ? {} : { placeHours })}
                    onOpen={setOpen}
                    said={said}
                  />
                </>
              ) : (
                <Tabs
                  label={strings.menuSettings}
                  tabs={[
                    {
                      id: 'structure',
                      label: strings.tabStructure,
                      count: draft.sections.filter((each) => each.menuId === current.id).length,
                    },
                    {
                      id: 'dishes',
                      // Every dish of the workspace, not this menu's (checklabs' Items).
                      label: strings.tabAllDishes,
                      count: draft.items.length,
                      ...(unpriced.length === 0 ? {} : { alert: strings.needsPrice(unpriced.length) }),
                    },
                    { id: 'options', label: strings.tabAllOptions, count: draft.groups.length },
                  ]}
                  selectedKey={tab}
                  onSelectionChange={(id) =>
                    go({ tab: (MENU_TABS as readonly string[]).includes(id) ? (id as MenuTab) : 'structure' })
                  }
                >
                  <TabPanel id="structure" variant="fields">
                    <StructureTab
                      key={current.id}
                      store={store}
                      slug={slug}
                      draft={draft}
                      menuId={current.id}
                      onOpen={setOpen}
                      said={said}
                      toasts={toasts}
                    />
                  </TabPanel>
                  <TabPanel id="dishes">
                    <DishesTab store={store} slug={slug} draft={draft} onOpen={setOpen} said={said} toasts={toasts} />
                  </TabPanel>
                  <TabPanel id="options">
                    <OptionsTab draft={draft} onOpen={setOpen} />
                  </TabPanel>
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
              title={strings.hideQuestion}
              isOpen={open?.kind === 'hide'}
              onOpenChange={(isOpen) => {
                if (!isOpen) setOpen(undefined);
              }}
              actions={
                <>
                  <Button slot="close">{strings.keepLive}</Button>
                  <Button
                    variant="danger-solid"
                    onPress={() => {
                      setOpen(undefined);
                      setHidden(true);
                    }}
                  >
                    {strings.hideMenu}
                  </Button>
                </>
              }
            >
              {strings.hideLine}
            </Modal>
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
