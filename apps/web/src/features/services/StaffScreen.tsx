// Brief
// Purpose: Settings › Staff (spec 0066 B1, AC-6611, AC-6613; Fresha's Team members): the people clients book, with
// their photo, title, where they work, how many services they do and whether they sign in.
// Main task: add someone by name (they start working every place's opening hours and doing every service), then
// open their profile to adjust.
// Leaves out: their shifts week by week (Settings › Shifts), and their calendar (B3).
import type { ServicesStore, StaffView } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { CATALOGUE_LIMITS } from '@crm/data/services';
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
  PersonLine,
  Table,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import { SettingsMissing, SettingsPage } from '../settings/SettingsPage.tsx';
import { staffProfileHref } from '../settings/nav.ts';
import { NotInstalled } from './NotInstalled.tsx';
import { SetupSteps, useSetupShown } from './SetupSteps.tsx';
import { strings } from './strings.ts';

/** Props for Settings › Staff. */
export interface StaffScreenProps {
  readonly store: ServicesStore;
  readonly slug: string;
  readonly toasts: Toasts;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'person', label: strings.person, isRowHeader: true, size: 'fill' },
  { id: 'works', label: strings.works, size: 'fit' },
  { id: 'does', label: strings.does, size: 'fit' },
  { id: 'signs', label: strings.signsIn, size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit', showsOnHover: true },
];

/** The team list. */
export function StaffScreen({ store, slug, toasts }: StaffScreenProps) {
  const state = useHospitality(store.team(slug));
  const catalogue = useHospitality(store.catalogue(slug));
  const navigate = useNavigate();
  const [isAdding, setAdding] = useState(false);
  // Who an archive asks about: one person (their row's menu) or every ticked person (the bulk bar).
  const [archiving, setArchiving] = useState<readonly StaffView[] | undefined>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const team = state.status === 'ready' ? state.value : undefined;
  const setupShown = useSetupShown(slug, catalogue.status === 'ready' ? catalogue.value.setup : undefined);
  const live = useMemo(() => team?.staff.filter((each) => !each.archived) ?? [], [team]);
  const archived = useMemo(() => team?.staff.filter((each) => each.archived) ?? [], [team]);
  const placeName = new Map(team?.places.map((place) => [place.id, place.name]) ?? []);
  const allServices = team?.services.length ?? 0;
  const said = (refused: { readonly message: string } | undefined) => {
    if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
  };
  const open = (person: StaffView) => void navigate({ href: staffProfileHref(slug, person.id) });
  /** Archives each (in order), then one toast for all that went, with one Undo bringing them back. */
  const archive = async (people: readonly StaffView[]) => {
    const gone: StaffView[] = [];
    for (const person of people) {
      const refused = await store.archiveStaff(slug, person.id);
      if (refused === undefined) gone.push(person);
      else said(refused);
    }
    if (gone.length === 0) return;
    toasts.toast({
      tone: 'success',
      message: gone.length === 1 ? strings.staffArchived(gone[0]?.name ?? '') : strings.staffArchivedMany(gone.length),
      action: {
        label: strings.undo,
        onAction: () => {
          for (const person of gone) void store.restoreStaff(slug, person.id).then(said);
        },
      },
    });
  };

  if (state.status === 'error') {
    if (state.error.code === 'APP_NOT_INSTALLED') return <NotInstalled slug={slug} title={strings.staffTitle} />;
    if (state.error.code === 'FORBIDDEN') return <SettingsMissing backTo="home" />;
    return (
      <SettingsPage title={strings.staffTitle}>
        <EmptyState
          title={strings.failed}
          icon="id-card"
          actions={<Button onPress={() => store.team(slug).retry()}>{strings.retry}</Button>}
        >
          {state.error.message}
        </EmptyState>
      </SettingsPage>
    );
  }

  const isFull = live.length >= CATALOGUE_LIMITS.staff;
  const blocked = (archiving ?? []).reduce((total, person) => total + person.upcoming, 0);
  const ticked = live.filter((each) => selected.has(each.id));
  const photoOf = (person: StaffView) =>
    person.photo === undefined ? undefined : store.staffPhotoSrc(slug, person.id, person.photo);

  return (
    <SettingsPage
      title={strings.staffTitle}
      isLoading={team === undefined}
      actions={
        // The checklist (or the empty list) holds the one next action while it shows; then Add staff leads.
        <Button
          variant={setupShown.isShown || live.length === 0 ? 'secondary' : 'primary'}
          icon="plus"
          isDisabled={team === undefined || isFull}
          onPress={() => setAdding(true)}
        >
          {strings.addStaff}
        </Button>
      }
    >
      {catalogue.status === 'ready' && setupShown.isShown ? (
        <SetupSteps
          slug={slug}
          setup={catalogue.value.setup}
          onHere={{ staff: () => setAdding(true) }}
          onHide={setupShown.hide}
        />
      ) : null}
      {isFull ? <Callout tone="info">{strings.limitStaff(CATALOGUE_LIMITS.staff)}</Callout> : null}
      {ticked.length > 0 ? (
        <BulkActionBar count={ticked.length} total={live.length} onClear={() => setSelected(new Set())}>
          <Button icon="archive" onPress={() => setArchiving(ticked)}>
            {strings.archive}
          </Button>
        </BulkActionBar>
      ) : null}
      <Table
        label={strings.staffTitle}
        isScrollable
        columns={COLUMNS}
        rows={live}
        isLoading={team === undefined}
        getRowId={(person) => person.id}
        getRowLabel={(person) => person.name}
        selected={selected}
        onSelectedChange={setSelected}
        getSelectLabel={(person) => strings.selectStaff(person.name)}
        onRowAction={(id) => {
          const person = live.find((each) => each.id === id);
          if (person !== undefined) open(person);
        }}
        onReorder={(id, targetId, position) => {
          const rest = live.filter((each) => each.id !== id);
          const at = rest.findIndex((each) => each.id === targetId);
          if (at < 0) return;
          void store.moveStaff(slug, id, at + (position === 'after' ? 1 : 0)).then(said);
        }}
        renderCell={(person, column) => {
          const index = live.indexOf(person);
          switch (column) {
            case 'person': {
              const picture = photoOf(person);
              return (
                <PersonLine
                  id={person.id}
                  name={person.name}
                  meta={person.title === undefined ? [] : [person.title]}
                  size="md"
                  {...(picture === undefined ? {} : { picture })}
                  {...(person.color === undefined ? {} : { hue: person.color })}
                />
              );
            }
            case 'works':
              return strings.placesCount(person.places.map((at) => placeName.get(at.placeId) ?? ''));
            case 'does':
              return strings.doesCount(person.serviceIds.length, allServices);
            case 'signs':
              return person.memberName ?? strings.notSignedIn;
            default:
              return (
                <MenuTrigger>
                  <Button variant="ghost" icon="ellipsis" label={strings.staffActions(person.name)} />
                  <Menu
                    label={strings.staffActions(person.name)}
                    disabledKeys={[...(index <= 0 ? ['up'] : []), ...(index >= live.length - 1 ? ['down'] : [])]}
                    onAction={(key) => {
                      if (key === 'open') open(person);
                      if (key === 'up') void store.moveStaff(slug, person.id, index - 1).then(said);
                      if (key === 'down') void store.moveStaff(slug, person.id, index + 1).then(said);
                      if (key === 'archive') setArchiving([person]);
                    }}
                  >
                    <MenuItem id="open" icon="pencil">
                      {strings.openProfile}
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
        }}
        emptyState={
          <EmptyState
            title={strings.noStaff}
            icon="id-card"
            {...(setupShown.isShown
              ? {}
              : {
                  actions: (
                    <Button variant="primary" icon="plus" onPress={() => setAdding(true)}>
                      {strings.addStaff}
                    </Button>
                  ),
                })}
          >
            {strings.noStaffText}
          </EmptyState>
        }
      />
      {archived.length > 0 ? (
        <Disclosure title={strings.archived} count={archived.length} variant="quiet">
          <Table
            label={strings.archived}
            columns={[
              { id: 'person', label: strings.person, isRowHeader: true, size: 'fill' },
              { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
            ]}
            rows={archived}
            getRowId={(person) => person.id}
            isHeaderHidden
            renderCell={(person, column) =>
              column === 'person' ? (
                person.name
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="archive-restore"
                  onPress={() => void store.restoreStaff(slug, person.id).then(said)}
                >
                  {strings.restore}
                </Button>
              )
            }
          />
        </Disclosure>
      ) : null}
      {isAdding && team !== undefined ? (
        <AddStaffDialog
          onClose={() => setAdding(false)}
          onAdd={async (name, title) => {
            const id = store.newId();
            // Foolproof: every place (at its opening hours) and every service, narrowed on the profile.
            const refused = await store.saveStaff(slug, id, {
              name,
              ...(title === '' ? {} : { title }),
              color: null,
              placeIds: team.places.map((place) => place.id),
              serviceIds: team.services.map((service) => service.id),
            });
            if (refused !== undefined) return refused.message;
            setAdding(false);
            void navigate({ href: staffProfileHref(slug, id) });
            return undefined;
          }}
        />
      ) : null}
      <Modal
        variant="confirm"
        title={
          archiving === undefined
            ? ''
            : archiving.length === 1
              ? strings.archiveQuestion(archiving[0]?.name ?? '')
              : strings.archiveManyQuestion(archiving.length)
        }
        isOpen={archiving !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setArchiving(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="danger-solid"
              // Refused anyway while they have visits to come: the line says why, and the button waits.
              isDisabled={blocked > 0}
              onPress={() => {
                if (archiving !== undefined) void archive(archiving);
                setArchiving(undefined);
                setSelected(new Set());
              }}
            >
              {strings.archive}
            </Button>
          </>
        }
      >
        {blocked > 0 ? strings.upcomingBlocks(blocked) : strings.archiveLine}
      </Modal>
    </SettingsPage>
  );
}

/** Adds someone by name and title; the profile opens after. */
function AddStaffDialog({
  onClose,
  onAdd,
}: {
  readonly onClose: () => void;
  readonly onAdd: (name: string, title: string) => Promise<string | undefined>;
}) {
  const formId = useId();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  return (
    <Modal
      variant="form"
      title={strings.addStaff}
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" type="submit" form={formId} isPending={isSaving} isDisabled={name.trim() === ''}>
            {strings.add}
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
          void onAdd(name.trim(), title.trim()).then((refused) => {
            setSaving(false);
            setError(refused);
          });
        }}
      >
        <Field
          label={strings.staffName}
          value={name}
          onChange={setName}
          maxLength={CATALOGUE_LIMITS.staffNameMax}
          isRequired
          {...(error === undefined ? {} : { error })}
        />
        <Field
          label={strings.staffTitleField}
          value={title}
          onChange={setTitle}
          placeholder={strings.staffTitleHint}
          maxLength={CATALOGUE_LIMITS.staffTitleMax}
        />
      </Form>
    </Modal>
  );
}
