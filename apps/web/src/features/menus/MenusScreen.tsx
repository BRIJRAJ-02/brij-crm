// Brief
// Purpose: the Menu app's editor (spec 0065, H1, AC-6520 to AC-6526): menus, their sections and dishes, Publish.
// Main task: build a menu and publish it, watching the guest menu take shape in the phone beside it.
// Leaves out: the guest look's presets (H5), QR codes (H2, the Menu QR app), import (H6), analytics (spec 0066).
import {
  isDataError,
  type MenuDraft,
  type MenuItem as Dish,
  type MenuSection,
  type MenuStore,
  type PlaceHours,
} from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { formatPrice } from '@crm/data/menu';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  ChoiceChips,
  Menu,
  MenuItem,
  MenuTrigger,
  CopyButton,
  EmptyState,
  Field,
  MenuList,
  Modal,
  PreviewLayout,
  SegmentedControl,
  SetupChecklist,
  Switch,
  TabPanel,
  Tabs,
  TopBar,
  type Toasts,
} from '@crm/ui';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { publicMenuUrl } from '../booking/links.ts';
import { businessSettingsHref } from '../settings/nav.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { ItemDialog } from './ItemDialog.tsx';
import { draftPhotoHref } from './photo.ts';
import { previewMenu, publishBlocker } from './preview.ts';
import { strings } from './strings.ts';

/** What the screen opens over itself: a dish's form, a confirm. */
type Open =
  | { readonly kind: 'item'; readonly item?: Dish; readonly sectionId?: string; readonly newName?: string }
  | { readonly kind: 'discard' }
  | { readonly kind: 'deleteMenu'; readonly menuId: string; readonly name: string }
  | { readonly kind: 'deleteSection'; readonly sectionId: string; readonly name: string }
  | undefined;

export interface MenusScreenProps {
  readonly store: MenuStore;
  readonly slug: string;
  readonly toasts: Toasts;
  /** The business's name and each place's hours, for the preview's header and the checklist. */
  readonly business: { readonly name: string; readonly hours: Readonly<Record<string, PlaceHours>> };
}

/** The Menus screen (spec 0065, H1). */
export function MenusScreen({ store, slug, toasts, business }: MenusScreenProps) {
  const state = useHospitality(store.draft(slug));
  const [menuId, setMenuId] = useState<string | undefined>();
  const [placeId, setPlaceId] = useState<string | undefined>();
  const [open, setOpen] = useState<Open>();
  const [isPublishing, setPublishing] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const router = useRouter();
  // "Published" stands in the button for two seconds after a publish, then it reads Publish again.
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
  const menus = [...draft.menus].sort((a, b) => a.position - b.position);
  const current = menus.find((each) => each.id === menuId) ?? menus[0];
  const blocker = publishBlocker(draft);
  const isLive = draft.publishedAt !== undefined;

  const publish = async () => {
    setPublishing(true);
    const refused = await store.publish(slug);
    setPublishing(false);
    if (refused !== undefined) {
      said(refused);
      return;
    }
    setJustPublished(true);
  };

  const copyLink = async (link: string) => {
    try {
      await globalThis.navigator.clipboard.writeText(link);
      toasts.toast({ tone: 'success', message: strings.linkCopied });
    } catch {
      toasts.toast({ tone: 'danger', message: link });
    }
  };

  const newMenu = () => {
    const id = store.newId();
    setMenuId(id);
    void store
      .saveMenu(slug, { id, name: strings.newMenuName, placeIds: draft.places.map((each) => each.id) })
      .then(said);
  };

  const steps = [
    {
      id: 'hours',
      title: strings.stepPlace,
      detail: place !== undefined && hasHours(business.hours[place.id]) ? strings.stepPlaceDone : strings.stepPlaceTodo,
      isDone: place !== undefined && hasHours(business.hours[place.id]),
      action: strings.open,
    },
    { id: 'menu', title: strings.stepMenu, isDone: draft.menus.length > 0, action: strings.add },
    {
      id: 'items',
      title: strings.stepItems,
      isDone: draft.sections.some((section) => section.itemIds.length > 0),
      action: strings.add,
    },
    // Publish has one primary button, the page's own; the step only says where it is.
    { id: 'publish', title: strings.stepPublish, detail: strings.stepPublishDetail, isDone: isLive },
    {
      id: 'share',
      title: strings.stepShare,
      detail: isLive ? strings.stepShareDetail : strings.stepShareLater,
      isDone: false,
      ...(isLive ? { action: strings.copyLink } : {}),
    },
  ];

  const actions = (
    <>
      {draft.changes > 0 && isLive ? (
        <Button onPress={() => setOpen({ kind: 'discard' })} isDisabled={!draft.canEdit}>
          {strings.discard}
        </Button>
      ) : null}
      {place === undefined || !isLive ? null : (
        <ButtonLink href={publicMenuUrl(place.menuKey)} isExternal icon="external-link">
          {strings.openGuest}
        </ButtonLink>
      )}
      {draft.canEdit ? (
        <Button
          variant="primary"
          isPending={isPublishing}
          isDisabled={(draft.changes === 0 && isLive) || blocker !== undefined}
          onPress={() => void publish()}
          {...(blocker === undefined ? {} : { 'aria-describedby': 'menu-blocker' })}
        >
          {isPublishing ? strings.publishing : justPublished ? strings.published : strings.publish}
        </Button>
      ) : null}
    </>
  );

  const preview =
    place === undefined ? undefined : (
      <MenuList
        menu={previewMenu(draft, place, {
          businessName: business.name,
          ...(business.hours[place.id] === undefined ? {} : { hours: business.hours[place.id] }),
        })}
        photoHref={(photoId, size, version) => draftPhotoHref(slug, photoId, size, version)}
      />
    );

  return (
    <WorkspacePage
      currentPage="menus"
      page={{
        topBar: (
          <TopBar
            title={strings.title}
            icon="utensils"
            meta={draft.changes > 0 ? strings.changes(draft.changes) : isLive ? strings.upToDate : strings.draft}
          >
            {actions}
          </TopBar>
        ),
        body: (
          <>
            <PreviewLayout
              previewShare="wide"
              notices={
                <>
                  {!isLive ? (
                    <SetupChecklist
                      title={strings.setup}
                      steps={steps}
                      onAction={(id) => {
                        if (id === 'hours') router.history.push(businessSettingsHref(slug));
                        else if (id === 'menu') newMenu();
                        else if (id === 'share' && place !== undefined) void copyLink(publicMenuUrl(place.menuKey));
                        else if (id === 'items' && current !== undefined) {
                          const section = draft.sections.find((each) => each.menuId === current.id);
                          setOpen({ kind: 'item', ...(section === undefined ? {} : { sectionId: section.id }) });
                        }
                      }}
                    />
                  ) : null}
                  {blocker !== undefined && draft.menus.length > 0 ? (
                    <Callout
                      tone="warning"
                      actions={
                        blocker.reason === 'unpriced' ? (
                          <Button
                            onPress={() => {
                              const dish = draft.items.find((each) => each.id === blocker.itemId);
                              if (dish !== undefined) setOpen({ kind: 'item', item: dish });
                            }}
                          >
                            {strings.editNamed(blocker.name)}
                          </Button>
                        ) : (
                          <Button
                            onPress={() => {
                              const section = draft.sections.find((each) => each.menuId === current?.id);
                              setOpen({ kind: 'item', ...(section === undefined ? {} : { sectionId: section.id }) });
                            }}
                          >
                            {strings.addADish}
                          </Button>
                        )
                      }
                    >
                      <span id="menu-blocker">
                        {blocker.reason === 'empty' ? strings.emptyBlocker : strings.unpricedBlocker(blocker.name)}
                      </span>
                    </Callout>
                  ) : null}
                  {isLive && place !== undefined ? (
                    <Callout tone="info" title={strings.live}>
                      {publicMenuUrl(place.menuKey)}{' '}
                      <CopyButton value={publicMenuUrl(place.menuKey)} label={strings.copyLink} />
                    </Callout>
                  ) : null}
                </>
              }
              {...(preview === undefined ? {} : { preview })}
              {...(draft.places.length > 1
                ? {
                    previewControls: (
                      <SegmentedControl
                        label={strings.previewAt}
                        segments={draft.places.map((each) => ({ value: each.id, label: each.name }))}
                        value={place?.id ?? ''}
                        onChange={setPlaceId}
                      />
                    ),
                  }
                : {})}
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
                  onSelectionChange={setMenuId}
                  end={
                    draft.canEdit && draft.menus.length < 30 ? (
                      <Button icon="plus" onPress={newMenu}>
                        {strings.newMenu}
                      </Button>
                    ) : undefined
                  }
                >
                  {menus.map((menu) => (
                    <TabPanel key={menu.id} id={menu.id}>
                      <MenuEditor
                        store={store}
                        slug={slug}
                        draft={draft}
                        menuId={menu.id}
                        onOpen={setOpen}
                        said={said}
                        toasts={toasts}
                      />
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
                      if (open?.kind === 'deleteMenu') void store.deleteMenu(slug, open.menuId).then(said);
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
          </>
        ),
      }}
    />
  );
}

/** A field saved when it loses focus (or Enter), never on every key: one change a field, not one a letter. */
function SavedField({
  label,
  value,
  hint,
  isReadOnly,
  isValid = (next: string) => next.trim() !== '',
  onSave,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly isReadOnly?: boolean;
  readonly isValid?: (next: string) => boolean;
  readonly onSave: (next: string) => void;
}) {
  const [text, setText] = useState(value);
  const commit = () => {
    if (!isValid(text)) setText(value);
    else if (text !== value) onSave(text.trim());
  };
  return (
    <Field
      label={label}
      value={text}
      onChange={setText}
      onBlur={commit}
      onSubmit={commit}
      {...(hint === undefined ? {} : { hint })}
      {...(isReadOnly === undefined ? {} : { isReadOnly })}
    />
  );
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether a place has any opening hours in its week. */
const hasHours = (hours: PlaceHours | undefined): boolean =>
  hours !== undefined && Object.values(hours.weekly).some((ranges) => ranges.length > 0);

/** One menu's settings and its sections. */
function MenuEditor({
  store,
  slug,
  draft,
  menuId,
  onOpen,
  said,
  toasts,
}: {
  readonly toasts: Toasts;
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly menuId: string;
  readonly onOpen: (open: Open) => void;
  readonly said: (refused: { readonly message: string } | undefined) => void;
}) {
  const menu = draft.menus.find((each) => each.id === menuId);
  const sections = useMemo(
    () => draft.sections.filter((each) => each.menuId === menuId).sort((a, b) => a.position - b.position),
    [draft.sections, menuId],
  );
  if (menu === undefined) return null;
  const save = (change: Partial<Parameters<MenuStore['saveMenu']>[1]>) =>
    void store
      .saveMenu(slug, {
        id: menu.id,
        name: menu.name,
        placeIds: menu.placeIds,
        ...(menu.note === undefined ? {} : { note: menu.note }),
        ...change,
      })
      .then(said);
  const top = sections.filter((each) => each.parentId === undefined);
  return (
    <>
      <Card
        title={strings.menuSettings}
        actions={
          draft.canEdit ? (
            <Button
              variant="ghost"
              icon="trash"
              onPress={() => onOpen({ kind: 'deleteMenu', menuId: menu.id, name: menu.name })}
            >
              {strings.deleteMenu}
            </Button>
          ) : undefined
        }
      >
        <SavedField
          label={strings.menuName}
          value={menu.name}
          isReadOnly={!draft.canEdit}
          onSave={(name) => save({ name })}
        />
        {draft.places.length > 1 ? (
          <ChoiceChips
            label={strings.showsAt}
            choices={draft.places.map((place) => ({ id: place.id, label: place.name }))}
            selected={menu.placeIds}
            onChange={(placeIds) => save({ placeIds: [...placeIds] })}
            isDisabled={!draft.canEdit}
          />
        ) : null}
        <Switch
          label={strings.servingTimes}
          isSelected={menu.serving !== undefined}
          isReadOnly={!draft.canEdit}
          onChange={(on) => save({ serving: on ? { days: ['sat', 'sun'], from: '10:00', to: '15:00' } : null })}
        />
        {menu.serving === undefined ? null : (
          <>
            <ChoiceChips
              label={strings.servingDays}
              choices={(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => ({
                id: day,
                label: strings.days[day],
              }))}
              selected={menu.serving.days}
              onChange={(days) => {
                if (days.length > 0 && menu.serving !== undefined) {
                  save({ serving: { ...menu.serving, days: days as typeof menu.serving.days } });
                }
              }}
            />
            <SavedField
              label={strings.from}
              value={menu.serving.from}
              isValid={(next) => TIME.test(next.trim())}
              onSave={(from) => {
                if (menu.serving !== undefined) save({ serving: { ...menu.serving, from } });
              }}
            />
            <SavedField
              label={strings.to}
              value={menu.serving.to}
              isValid={(next) => TIME.test(next.trim())}
              onSave={(to) => {
                if (menu.serving !== undefined) save({ serving: { ...menu.serving, to } });
              }}
            />
          </>
        )}
        <SavedField
          label={strings.menuNote}
          hint={strings.menuNoteHint}
          value={menu.note ?? ''}
          isReadOnly={!draft.canEdit}
          isValid={(next) => next.length <= 300}
          onSave={(note) => save({ note })}
        />
      </Card>
      {top.map((section, index) => (
        <SectionCard
          key={section.id}
          index={index}
          store={store}
          slug={slug}
          draft={draft}
          section={section}
          subsections={sections.filter((each) => each.parentId === section.id)}
          onOpen={onOpen}
          said={said}
          toasts={toasts}
        />
      ))}
      {draft.canEdit ? (
        <Button
          icon="plus"
          onPress={() =>
            void store
              .saveSection(slug, {
                id: store.newId(),
                menuId,
                name: top.length === 0 ? strings.newSectionName : `${strings.sections} ${String(top.length + 1)}`,
                layout: 'list',
              })
              .then(said)
          }
        >
          {strings.newSection}
        </Button>
      ) : null}
    </>
  );
}

/** One section: its name and layout, Add dishes (search what exists first, or make a new one), and its dishes. */
function SectionCard({
  index,
  store,
  slug,
  draft,
  section,
  subsections,
  onOpen,
  said,
  toasts,
}: {
  readonly toasts: Toasts;
  readonly index: number;
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly section: MenuSection;
  readonly subsections: readonly MenuSection[];
  readonly onOpen: (open: Open) => void;
  readonly said: (refused: { readonly message: string } | undefined) => void;
}) {
  const [query, setQuery] = useState('');
  const items = new Map(draft.items.map((item) => [item.id, item]));
  const matches =
    query.trim() === ''
      ? []
      : draft.items
          .filter(
            (item) =>
              !section.itemIds.includes(item.id) && item.name.toLowerCase().includes(query.trim().toLowerCase()),
          )
          .slice(0, 5);
  const menuNames = (itemId: string) =>
    draft.sections
      .filter((each) => each.id !== section.id && each.itemIds.includes(itemId))
      .map((each) => draft.menus.find((menu) => menu.id === each.menuId)?.name)
      .filter((name): name is string => name !== undefined);
  return (
    <Card
      title={strings.sectionNumber(index + 1)}
      {...(section.description === undefined ? {} : { description: section.description })}
      actions={
        draft.canEdit ? (
          <Button
            variant="ghost"
            icon="trash"
            label={strings.deleteSection}
            onPress={() => onOpen({ kind: 'deleteSection', sectionId: section.id, name: section.name })}
          />
        ) : undefined
      }
    >
      {draft.canEdit ? (
        <>
          <SavedField
            label={strings.sectionName}
            value={section.name}
            onSave={(name) => void store.saveSection(slug, { ...sectionInput(section), name }).then(said)}
          />
          <SegmentedControl
            label={strings.sectionLayout}
            segments={[
              { value: 'list', label: strings.layoutList },
              { value: 'grid', label: strings.layoutGrid },
            ]}
            value={section.layout}
            onChange={(layout: string) =>
              void store
                .saveSection(slug, { ...sectionInput(section), layout: layout === 'grid' ? 'grid' : 'list' })
                .then(said)
            }
          />
          <Field
            label={strings.addDish}
            icon="search"
            placeholder={strings.addDishPlaceholder}
            value={query}
            onChange={setQuery}
            onSubmit={() => {
              const name = query.trim();
              if (name === '') return;
              const existing = matches[0];
              setQuery('');
              if (existing !== undefined && existing.name.toLowerCase() === name.toLowerCase()) {
                void store.placeItem(slug, existing.id, section.id, true).then(said);
              } else {
                onOpen({ kind: 'item', sectionId: section.id, newName: name });
              }
            }}
          />
          {query.trim() === '' ? null : (
            <>
              {matches.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  icon="plus"
                  onPress={() => {
                    setQuery('');
                    void store.placeItem(slug, item.id, section.id, true).then(said);
                  }}
                >
                  {item.name}
                </Button>
              ))}
              <Button
                variant="ghost"
                icon="plus"
                onPress={() => {
                  const name = query.trim();
                  setQuery('');
                  onOpen({ kind: 'item', sectionId: section.id, newName: name });
                }}
              >
                {strings.createDish(query.trim())}
              </Button>
            </>
          )}
        </>
      ) : null}
      {section.itemIds.length === 0 ? (
        <EmptyState title={strings.emptySection} layout="row" />
      ) : (
        section.itemIds.map((itemId) => {
          const item = items.get(itemId);
          if (item === undefined) return null;
          const also = menuNames(itemId);
          return (
            <Card
              key={itemId}
              tone="sunken"
              title={item.name}
              description={[
                item.priceMinor !== undefined
                  ? formatPrice(item.priceMinor, draft.currency, draft.places[0]?.locale ?? 'en-GB')
                  : item.sizes.length > 0
                    ? item.sizes
                        .map(
                          (size) =>
                            `${size.name} ${formatPrice(size.priceMinor, draft.currency, draft.places[0]?.locale ?? 'en-GB')}`,
                        )
                        .join(' · ')
                    : (item.priceNote ?? strings.noPrice),
                also.length === 0 ? '' : strings.alsoOn(also.join(', ')),
              ]
                .filter((part) => part !== '')
                .join(' · ')}
              actions={
                <>
                  <Switch
                    label={strings.soldOut}
                    labelContext={item.name}
                    isSelected={item.soldOut}
                    onChange={(soldOut) => void store.setSoldOut(slug, item.id, soldOut).then(said)}
                  />
                  {draft.canEdit ? (
                    <>
                      <Button onPress={() => onOpen({ kind: 'item', item })}>{strings.editDish}</Button>
                      <MenuTrigger>
                        <Button variant="ghost" icon="ellipsis" label={strings.moreFor(item.name)} />
                        <Menu
                          label={strings.moreFor(item.name)}
                          onAction={() => {
                            void store.placeItem(slug, item.id, section.id, false).then((refused) => {
                              if (refused !== undefined) {
                                said(refused);
                                return;
                              }
                              toasts.toast({
                                tone: 'info',
                                message: strings.removed(item.name),
                                action: {
                                  label: strings.undo,
                                  onAction: () => void store.placeItem(slug, item.id, section.id, true).then(said),
                                },
                              });
                            });
                          }}
                        >
                          <MenuItem id="remove" icon="x">
                            {strings.removeFromSection}
                          </MenuItem>
                        </Menu>
                      </MenuTrigger>
                    </>
                  ) : null}
                </>
              }
            />
          );
        })
      )}
      {subsections.map((sub) => (
        <Callout key={sub.id} tone="info" title={sub.name}>
          {sub.itemIds
            .map((id) => items.get(id)?.name)
            .filter((name) => name !== undefined)
            .join(', ')}
        </Callout>
      ))}
    </Card>
  );
}

/** A section's own fields, as a save sends them back. */
const sectionInput = (section: MenuSection) => ({
  id: section.id,
  menuId: section.menuId,
  ...(section.parentId === undefined ? {} : { parentId: section.parentId }),
  name: section.name,
  ...(section.description === undefined ? {} : { description: section.description }),
  layout: section.layout,
});

/** Whether a refusal is the app gate's, for the route. */
export const isNotInstalled = (error: unknown): boolean =>
  isDataError(error) && (error.code === 'APP_NOT_INSTALLED' || error.code === 'NOT_FOUND');
