// Brief
// Purpose: Settings › Services (spec 0066 B1, AC-6610, AC-6613; Fresha's catalogue): the services clients book, in
// categories, each with its length, price, who does it and whether it books online.
// Main task: add a service, then order the list the way clients should read it (drag, or Move up and down).
// Leaves out: the booking flow (B2), per staff prices (later), and the staff themselves (Settings › Staff).
import type { CatalogueCategory, CatalogueService, CatalogueView, ServicesStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { CATALOGUE_LIMITS, starterService } from '@crm/data/services';
import {
  BulkActionBar,
  Button,
  Callout,
  Disclosure,
  EmptyState,
  Field,
  Form,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  Select,
  SettingsSection,
  Switch,
  Table,
  type SelectItem,
  type TableColumn,
  type Toasts,
  useFormatSettings,
} from '@crm/ui';
import { useId, useMemo, useState } from 'react';
import { SettingsMissing, SettingsPage } from '../settings/SettingsPage.tsx';
import { servicePrice, serviceLength } from './format.ts';
import { StartBusiness } from '../hospitality/StartBusiness.tsx';
import { NotInstalled } from './NotInstalled.tsx';
import { ServiceDrawer, type ServiceStart } from './ServiceDrawer.tsx';
import { SetupSteps, useSetupShown } from './SetupSteps.tsx';
import { strings } from './strings.ts';

/** Props for Settings › Services. */
export interface ServicesScreenProps {
  readonly store: ServicesStore;
  readonly slug: string;
  readonly toasts: Toasts;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.service, isRowHeader: true },
  { id: 'length', label: strings.length, size: 'fit' },
  { id: 'price', label: strings.price, align: 'end', size: 'fit' },
  { id: 'staff', label: strings.who, size: 'fit' },
  { id: 'online', label: strings.online, size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit', showsOnHover: true },
];

/** What is open over the list. */
type Open =
  | { readonly kind: 'service'; readonly service?: CatalogueService; readonly start?: ServiceStart }
  | { readonly kind: 'category'; readonly category?: CatalogueCategory }
  | { readonly kind: 'delete-category'; readonly category: CatalogueCategory };

/** The catalogue. */
export function ServicesScreen({ store, slug, toasts }: ServicesScreenProps) {
  const { locale } = useFormatSettings();
  const newId = store.newId;
  const state = useHospitality(store.catalogue(slug));
  const [open, setOpen] = useState<Open | undefined>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const view = state.status === 'ready' ? state.value : undefined;
  const setupShown = useSetupShown(slug, view?.setup);
  const live = useMemo(() => view?.services.filter((service) => !service.archived) ?? [], [view]);
  const archived = useMemo(() => view?.services.filter((service) => service.archived) ?? [], [view]);
  const said = (refused: { readonly message: string } | undefined) => {
    if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
  };
  const isFull = live.length >= CATALOGUE_LIMITS.services;
  const newService = (start?: ServiceStart) => setOpen({ kind: 'service', ...(start === undefined ? {} : { start }) });

  /**
   * The starter for this kind of business (Foolproof), in its category: an existing one by that name, else one the
   * drawer makes only when the service is saved, so Cancel leaves nothing behind.
   */
  const addStarter = (catalogue: CatalogueView) => {
    const starter = starterService(catalogue.businessKind);
    const existing = catalogue.categories.find((category) => category.name === starter.category);
    newService({
      name: starter.name,
      minutes: starter.minutes,
      ...(existing === undefined ? { categoryName: starter.category } : { categoryId: existing.id }),
    });
  };

  const archive = (services: readonly CatalogueService[]) => {
    const ids = services.map((service) => service.id);
    setSelected(new Set());
    void store.archive(slug, ids).then((refused) => {
      if (refused !== undefined) {
        said(refused);
        return;
      }
      toasts.toast({
        tone: 'success',
        message:
          services.length === 1 ? strings.archivedToast(services[0]?.name ?? '') : strings.archivedMany(ids.length),
        action: { label: strings.undo, onAction: () => void store.restore(slug, ids).then(said) },
      });
    });
  };

  if (state.status === 'error') {
    if (state.error.code === 'APP_NOT_INSTALLED') return <NotInstalled slug={slug} title={strings.servicesTitle} />;
    if (state.error.code === 'FORBIDDEN') return <SettingsMissing backTo="home" />;
    return (
      <SettingsPage title={strings.servicesTitle}>
        <EmptyState
          title={strings.failed}
          icon="scissors"
          actions={<Button onPress={() => store.catalogue(slug).retry()}>{strings.retry}</Button>}
        >
          {state.error.message}
        </EmptyState>
      </SettingsPage>
    );
  }

  const ticked = live.filter((service) => selected.has(service.id));
  // Each category in order, then the services with none ("Other services"), shown when there are any or no categories.
  const groups: readonly { readonly category?: CatalogueCategory; readonly services: readonly CatalogueService[] }[] =
    view === undefined
      ? []
      : [
          ...view.categories.map((category) => ({
            category,
            services: live.filter((service) => service.categoryId === category.id),
          })),
          ...(live.some((service) => service.categoryId === undefined)
            ? [{ services: live.filter((service) => service.categoryId === undefined) }]
            : []),
        ];
  const staffWords = (service: CatalogueService) =>
    service.staffRule === 'all' ? strings.allStaff : strings.staffCount(service.staffIds.length);
  const moveItems: readonly SelectItem[] = [
    ...(view?.categories ?? []).map((category) => ({ id: category.id, label: category.name })),
    { id: '', label: strings.noCategory, isApart: true },
  ];

  // No business yet: every workspace has Appointments on, so this is someone's first sight of it.
  if (view !== undefined && view.places.length === 0) {
    return (
      <SettingsPage title={strings.servicesTitle}>
        <StartBusiness
          slug={slug}
          app="appointments"
          icon="scissors"
          title={strings.startServices}
          text={strings.startServicesText}
          onDone={() => store.catalogue(slug).retry()}
        />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title={strings.servicesTitle}
      isLoading={view === undefined}
      actions={
        <>
          <Button isDisabled={view === undefined} onPress={() => setOpen({ kind: 'category' })}>
            {strings.newCategory}
          </Button>
          {/* The checklist (or the empty list) holds the one next action while it shows; then New service leads. */}
          <Button
            variant={setupShown.isShown || live.length === 0 ? 'secondary' : 'primary'}
            icon="plus"
            isDisabled={view === undefined || isFull}
            onPress={() => newService()}
          >
            {strings.newService}
          </Button>
        </>
      }
    >
      {view !== undefined && setupShown.isShown ? (
        <SetupSteps
          slug={slug}
          setup={view.setup}
          onHere={{ service: () => addStarter(view) }}
          onHide={setupShown.hide}
        />
      ) : null}
      {isFull ? <Callout tone="info">{strings.limitServices(CATALOGUE_LIMITS.services)}</Callout> : null}
      {view !== undefined && live.length === 0 && view.categories.length === 0 && !setupShown.isShown ? (
        // One next action: the checklist's while it shows (and then no empty state), else the starter here.
        <EmptyState
          title={strings.noServices}
          icon="scissors"
          actions={
            <Button variant="primary" icon="plus" onPress={() => addStarter(view)}>
              {strings.addStarter(starterService(view.businessKind).name)}
            </Button>
          }
        >
          {strings.noServicesText}
        </EmptyState>
      ) : null}
      {ticked.length > 0 && view !== undefined ? (
        <BulkActionBar count={ticked.length} total={live.length} onClear={() => setSelected(new Set())}>
          <Select
            savesOnPick
            label={strings.moveTo}
            isLabelHidden
            placeholder={strings.moveTo}
            items={moveItems}
            value={null}
            onChange={(chosen) => {
              if (chosen === null) return;
              const ids = ticked.map((service) => service.id);
              setSelected(new Set());
              void store.setCategory(slug, ids, chosen === '' ? null : chosen).then(said);
            }}
          />
          <Button
            onPress={() => {
              const ids = ticked.map((service) => service.id);
              setSelected(new Set());
              void store.setOnline(slug, ids, true).then(said);
            }}
          >
            {strings.goOnline}
          </Button>
          <Button
            onPress={() => {
              const ids = ticked.map((service) => service.id);
              setSelected(new Set());
              void store.setOnline(slug, ids, false).then(said);
            }}
          >
            {strings.goOffline}
          </Button>
          <Button icon="archive" onPress={() => archive(ticked)}>
            {strings.archive}
          </Button>
        </BulkActionBar>
      ) : null}
      {groups.map((group) => {
        const title = group.category?.name ?? strings.noCategory;
        const rows = group.services;
        const categoryId = group.category?.id ?? null;
        const category = group.category;
        const categories = view?.categories ?? [];
        const at = category === undefined ? -1 : categories.indexOf(category);
        return (
          <SettingsSection
            key={category?.id ?? 'none'}
            title={title}
            actions={
              <>
                <Button
                  variant="ghost"
                  icon="plus"
                  label={strings.addToCategory(title)}
                  isDisabled={isFull}
                  onPress={() => newService(category === undefined ? undefined : { categoryId: category.id })}
                />
                {category === undefined ? null : (
                  <MenuTrigger>
                    <Button variant="ghost" icon="ellipsis" label={strings.categoryActions(category.name)} />
                    <Menu
                      label={strings.categoryActions(category.name)}
                      onAction={(key) => {
                        if (key === 'rename') setOpen({ kind: 'category', category });
                        if (key === 'up') void store.moveCategory(slug, category.id, at - 1).then(said);
                        if (key === 'down') void store.moveCategory(slug, category.id, at + 1).then(said);
                        if (key === 'delete') setOpen({ kind: 'delete-category', category });
                      }}
                      disabledKeys={[...(at <= 0 ? ['up'] : []), ...(at >= categories.length - 1 ? ['down'] : [])]}
                    >
                      <MenuItem id="rename" icon="pencil">
                        {strings.rename}
                      </MenuItem>
                      <MenuItem id="up" icon="arrow-up">
                        {strings.moveUp}
                      </MenuItem>
                      <MenuItem id="down" icon="arrow-down">
                        {strings.moveDown}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem id="delete" icon="trash" isDanger>
                        {strings.deleteCategory}
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                )}
              </>
            }
          >
            <Table
              label={strings.servicesIn(title)}
              isScrollable
              columns={COLUMNS}
              rows={rows}
              getRowId={(service) => service.id}
              getRowLabel={(service) => service.name}
              selected={selected}
              onSelectedChange={(ids) => {
                // Selection spans categories: this table's ticks replace only its own rows'.
                const mine = new Set(rows.map((service) => service.id));
                setSelected(new Set([...[...selected].filter((each) => !mine.has(each)), ...ids]));
              }}
              getSelectLabel={(service) => strings.selectService(service.name)}
              renderCell={(service, column) => {
                switch (column) {
                  case 'name':
                    return service.variants.length > 1
                      ? `${service.name} · ${strings.options(service.variants.length)}`
                      : service.name;
                  case 'length':
                    return serviceLength(service);
                  case 'price':
                    return servicePrice(service, view?.currency, locale);
                  case 'staff':
                    return staffWords(service);
                  case 'online':
                    return (
                      <Switch
                        label={strings.onlineFor(service.name)}
                        isLabelHidden
                        isSelected={service.online}
                        onChange={(online) => void store.setOnline(slug, [service.id], online).then(said)}
                      />
                    );
                  default: {
                    const index = rows.indexOf(service);
                    return (
                      <MenuTrigger>
                        <Button variant="ghost" icon="ellipsis" label={strings.serviceActions(service.name)} />
                        <Menu
                          label={strings.serviceActions(service.name)}
                          disabledKeys={[...(index <= 0 ? ['up'] : []), ...(index >= rows.length - 1 ? ['down'] : [])]}
                          onAction={(key) => {
                            if (key === 'edit') setOpen({ kind: 'service', service });
                            if (key === 'up')
                              void store.moveService(slug, service.id, categoryId, index - 1).then(said);
                            if (key === 'down')
                              void store.moveService(slug, service.id, categoryId, index + 1).then(said);
                            if (key === 'archive') archive([service]);
                          }}
                        >
                          <MenuItem id="edit" icon="pencil">
                            {strings.edit}
                          </MenuItem>
                          <MenuItem id="up" icon="arrow-up">
                            {strings.moveUp}
                          </MenuItem>
                          <MenuItem id="down" icon="arrow-down">
                            {strings.moveDown}
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem id="archive" icon="archive">
                            {strings.archive}
                          </MenuItem>
                        </Menu>
                      </MenuTrigger>
                    );
                  }
                }
              }}
              onRowAction={(id) => {
                const service = rows.find((each) => each.id === id);
                if (service !== undefined) setOpen({ kind: 'service', service });
              }}
              onReorder={(id, targetId, position) => {
                const rest = rows.filter((service) => service.id !== id);
                const target = rest.findIndex((service) => service.id === targetId);
                if (target < 0) return;
                void store.moveService(slug, id, categoryId, target + (position === 'after' ? 1 : 0)).then(said);
              }}
              emptyState={
                <EmptyState
                  title={strings.emptyCategory}
                  icon="scissors"
                  actions={
                    <Button
                      icon="plus"
                      isDisabled={isFull}
                      onPress={() => newService(category === undefined ? undefined : { categoryId: category.id })}
                    >
                      {strings.newService}
                    </Button>
                  }
                />
              }
            />
          </SettingsSection>
        );
      })}
      {archived.length > 0 ? (
        <Disclosure title={strings.archived} count={archived.length} variant="quiet">
          <Table
            label={strings.archived}
            columns={[
              { id: 'name', label: strings.service, isRowHeader: true, size: 'fill' },
              { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
            ]}
            rows={archived}
            getRowId={(service) => service.id}
            isHeaderHidden
            renderCell={(service, column) =>
              column === 'name' ? (
                service.name
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="archive-restore"
                  onPress={() => void store.restore(slug, [service.id]).then(said)}
                >
                  {strings.restore}
                </Button>
              )
            }
          />
        </Disclosure>
      ) : null}
      {open?.kind === 'service' && view !== undefined ? (
        <ServiceDrawer
          store={store}
          slug={slug}
          catalogue={view}
          {...(open.service === undefined ? {} : { service: open.service })}
          {...(open.start === undefined ? {} : { start: open.start })}
          newId={newId}
          locale={locale}
          toasts={toasts}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
      {open?.kind === 'category' ? (
        <CategoryDialog
          {...(open.category === undefined ? {} : { category: open.category })}
          onClose={() => setOpen(undefined)}
          onSave={async (name) => {
            const refused = await store.saveCategory(slug, open.category?.id ?? newId(), name);
            if (refused === undefined) setOpen(undefined);
            return refused?.message;
          }}
        />
      ) : null}
      <Modal
        variant="confirm"
        tone="danger"
        title={open?.kind === 'delete-category' ? strings.deleteCategoryQuestion(open.category.name) : ''}
        isOpen={open?.kind === 'delete-category'}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpen(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                if (open?.kind !== 'delete-category') return;
                const { category } = open;
                setOpen(undefined);
                void store.deleteCategory(slug, category.id).then(said);
              }}
            >
              {strings.delete}
            </Button>
          </>
        }
      >
        {strings.deleteCategoryLine}
      </Modal>
    </SettingsPage>
  );
}

/** Names a new category, or renames one. */
function CategoryDialog({
  category,
  onClose,
  onSave,
}: {
  readonly category?: CatalogueCategory;
  readonly onClose: () => void;
  readonly onSave: (name: string) => Promise<string | undefined>;
}) {
  const formId = useId();
  const [name, setName] = useState(category?.name ?? '');
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  return (
    <Modal
      title={category === undefined ? strings.categoryNew : strings.categoryRename}
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" type="submit" form={formId} isPending={isSaving} isDisabled={name.trim() === ''}>
            {strings.save}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={isSaving}
        onSubmit={() => {
          if (name.trim() === '') return;
          setSaving(true);
          void onSave(name.trim()).then((refused) => {
            setSaving(false);
            setError(refused);
          });
        }}
      >
        <Field
          label={strings.categoryName}
          value={name}
          onChange={setName}
          maxLength={CATALOGUE_LIMITS.categoryNameMax}
          {...(error === undefined ? {} : { error })}
        />
      </Form>
    </Modal>
  );
}
