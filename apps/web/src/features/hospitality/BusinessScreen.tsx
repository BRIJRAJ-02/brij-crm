// Brief
// Purpose: Settings › Business (spec 0065, AC-6507, AC-6508): the business the Hospitality apps share, and its places.
// Main task: keep the profile right, see each place at a glance, and open one for its hours and tables.
// Leaves out: menus, codes and reservation rules (each app's page), the logo (Settings › Brand), the cover photo.
import type { BusinessKind, BusinessProfile, HospitalityStore, Place, PlaceFields, ResourceKind } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { BUSINESS_KINDS, DEFAULT_RESOURCE_KIND } from '@crm/data/hospitality';
import {
  Button,
  ButtonLink,
  Card,
  CountryPicker,
  EmptyState,
  Field,
  Form,
  Modal,
  Select,
  SettingsRow,
  SettingsSection,
  Skeleton,
  Table,
  TruncatedText,
  useFormatSettings,
  type FormRefusal,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import { zoneItems, zoneMatches } from '../booking/hours.ts';
import { formRefusals } from '../settings/refusals.ts';
import { appsSettingsHref, businessPageHref, placeTablesHref } from '../settings/nav.ts';
import { pageStrings } from './business-page-strings.ts';
import { SettingsMissing, SettingsPage } from '../settings/SettingsPage.tsx';
import { clockLabel, todayRanges } from './hours-rows.ts';
import { StartBusiness } from './StartBusiness.tsx';
import { strings } from './strings.ts';

/** The places' columns, the count named for what this kind of business books. */
const placeColumns = (kind: ResourceKind): readonly TableColumn[] => [
  { id: 'name', label: strings.place, isRowHeader: true },
  { id: 'address', label: strings.address },
  { id: 'today', label: strings.today },
  { id: 'tables', label: strings.resourcesTitle(kind), align: 'end' },
];

/** A place's address on one line. */
const addressOf = (place: Place) =>
  [place.addressLine, place.city, place.postcode].filter((part) => part !== undefined && part !== '').join(', ');

/** Props for Settings › Business. */
export interface BusinessScreenProps {
  readonly store: HospitalityStore;
  readonly slug: string;
  readonly toasts: Toasts;
}

/** Settings › Business: the profile, then each place. */
export function BusinessScreen({ store, slug, toasts }: BusinessScreenProps) {
  const state = useHospitality(store.business(slug));
  const apps = useHospitality(store.apps(slug));
  const [isAdding, setAdding] = useState(false);
  const navigate = useNavigate();
  const { locale } = useFormatSettings();
  const now = useMemo(() => new Date(), []);
  // A place's count reads in the words of what this kind of business books (6 tables, 4 chairs).
  const businessKind = state.status === 'ready' ? state.value.profile?.kind : undefined;
  const countKind: ResourceKind = businessKind === undefined ? 'table' : DEFAULT_RESOURCE_KIND[businessKind];
  const columns = useMemo(() => placeColumns(countKind), [countKind]);
  // Someone without Manage hospitality meets the page as one that isn't there, never a locked one.
  if (state.status === 'error' && state.error.code === 'FORBIDDEN') return <SettingsMissing backTo="home" />;
  if (state.status === 'error') {
    const notInstalled = state.error.code === 'APP_NOT_INSTALLED';
    return (
      <SettingsPage title={strings.businessTitle}>
        <EmptyState
          title={notInstalled ? strings.notInstalled : strings.failed}
          icon="store"
          actions={
            notInstalled ? (
              <ButtonLink href={appsSettingsHref(slug)} variant="primary">
                {strings.openApps}
              </ButtonLink>
            ) : (
              <Button onPress={() => store.business(slug).retry()}>{strings.retry}</Button>
            )
          }
        >
          {notInstalled ? strings.notInstalledText : undefined}
        </EmptyState>
      </SettingsPage>
    );
  }
  const view = state.status === 'ready' ? state.value : undefined;
  // No business yet: the card makes it and its first place, as on every business page.
  if (view !== undefined && view.profile === undefined && view.places.length === 0) {
    const on = apps.status === 'ready' ? apps.value.apps.filter((each) => each.installed).map((each) => each.app) : [];
    const onApp =
      (['table_seating', 'menu', 'appointments'] as const).find((app) => on.includes(app)) ?? 'appointments';
    return (
      <SettingsPage title={strings.businessTitle}>
        <StartBusiness
          slug={slug}
          // An app that is on, so the card turns nothing back on; a salon's card starts on Salon.
          app={onApp}
          icon="store"
          title={strings.firstBusiness.title}
          text={strings.firstBusiness.text}
          onDone={() => store.business(slug).retry()}
        />
      </SettingsPage>
    );
  }
  return (
    <SettingsPage
      title={strings.businessTitle}
      actions={
        <Button icon="plus" isDisabled={view === undefined} onPress={() => setAdding(true)}>
          {strings.addPlace}
        </Button>
      }
    >
      {/* The public page (spec 0066, B4 lite): its own screen, one step from here. */}
      <SettingsSection title={pageStrings.title}>
        <Card>
          <SettingsRow title={pageStrings.title} description={pageStrings.cardText}>
            <ButtonLink href={businessPageHref(slug)} iconRight="arrow-right">
              {pageStrings.open}
            </ButtonLink>
          </SettingsRow>
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.profile}>
        {view === undefined ? (
          <Card isBusy>
            <Skeleton shape="field" />
          </Card>
        ) : (
          <ProfileCard
            // A new answer (another tab's save, a reload) starts the form again from it.
            key={JSON.stringify(view.profile ?? {})}
            profile={view.profile}
            onSave={async (fields) => {
              const refused = await store.saveBusiness(slug, fields);
              if (refused !== undefined) throw refused;
              toasts.toast({ tone: 'success', message: strings.saved });
            }}
          />
        )}
      </SettingsSection>
      <SettingsSection title={strings.places}>
        {view === undefined ? (
          <Card isBusy>
            <Skeleton shape="field" />
          </Card>
        ) : view.places.length === 0 ? (
          <EmptyState
            title={strings.noPlaces}
            icon="map-pin"
            actions={
              <Button variant="primary" icon="plus" onPress={() => setAdding(true)}>
                {strings.addPlace}
              </Button>
            }
          />
        ) : (
          <Table
            label={strings.places}
            columns={columns}
            rows={view.places}
            getRowId={(place) => place.id}
            layout="even"
            isScrollable
            onRowAction={(id) => void navigate({ href: placeTablesHref(slug, id) })}
            renderCell={(place, column) => {
              switch (column) {
                case 'name':
                  return place.name;
                case 'address':
                  return <TruncatedText>{addressOf(place)}</TruncatedText>;
                case 'today': {
                  const ranges = todayRanges(place.hours, place.timeZone, now);
                  return (
                    <TruncatedText>
                      {ranges.length === 0
                        ? strings.todayClosed
                        : ranges
                            .map((range) =>
                              strings.rangeText(clockLabel(range.from, locale), clockLabel(range.to, locale)),
                            )
                            .join(', ')}
                    </TruncatedText>
                  );
                }
                default:
                  return strings.resourceCount(countKind, place.resourceCount);
              }
            }}
          />
        )}
      </SettingsSection>
      <AddPlaceDialog
        key={isAdding ? 'open' : 'closed'}
        isOpen={isAdding}
        onOpenChange={setAdding}
        timeZone={view?.places[0]?.timeZone ?? 'UTC'}
        country={view?.places[0]?.country ?? null}
        onAdd={async (fields) => {
          const refused = await store.createPlace(slug, store.newId(), fields);
          if (refused !== undefined) throw refused;
        }}
      />
    </SettingsPage>
  );
}

const PROFILE_FIELDS = ['name', 'kind', 'description', 'phone', 'email', 'website'] as const;

/** The profile's fields, saved together with Save. */
function ProfileCard({
  profile,
  onSave,
}: {
  readonly profile: BusinessProfile | undefined;
  readonly onSave: (fields: {
    readonly name: string;
    readonly kind: BusinessKind;
    readonly description: string;
    readonly phone: string;
    readonly email: string;
    readonly website: string;
    readonly links: BusinessProfile['links'];
  }) => Promise<void>;
}) {
  const formId = useId();
  const [name, setName] = useState(profile?.name ?? '');
  const [kind, setKind] = useState<BusinessKind>(profile?.kind ?? 'restaurant');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [website, setWebsite] = useState(profile?.website ?? '');
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const changed =
    name !== (profile?.name ?? '') ||
    kind !== (profile?.kind ?? 'restaurant') ||
    description !== (profile?.description ?? '') ||
    phone !== (profile?.phone ?? '') ||
    email !== (profile?.email ?? '') ||
    website !== (profile?.website ?? '');
  const save = () => {
    if (isBusy || !changed) return;
    setBusy(true);
    setRefusals([]);
    onSave({ name, kind, description, phone, email, website, links: profile?.links ?? [] }).then(
      () => setBusy(false),
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, PROFILE_FIELDS));
      },
    );
  };
  return (
    <Card
      footer={
        <Button variant="primary" type="submit" form={formId} isDisabled={!changed} isPending={isBusy}>
          {isBusy ? strings.saving : strings.save}
        </Button>
      }
    >
      <Form
        id={formId}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={save}
        label={strings.profile}
      >
        <SettingsRow title={strings.businessName} control="field">
          <Field
            label={strings.businessName}
            isLabelHidden
            name="name"
            maxLength={80}
            value={name}
            onChange={setName}
          />
        </SettingsRow>
        <SettingsRow title={strings.kind} control="field">
          <Select
            label={strings.kind}
            isLabelHidden
            items={BUSINESS_KINDS.map((id) => ({ id, label: strings.kinds[id] }))}
            value={kind}
            onChange={(next) => {
              const picked = BUSINESS_KINDS.find((each) => each === next);
              if (picked !== undefined) setKind(picked);
            }}
          />
        </SettingsRow>
        <SettingsRow title={strings.description} control="field">
          <Field
            label={strings.description}
            isLabelHidden
            name="description"
            isMultiline
            showCounter
            maxLength={160}
            value={description}
            onChange={setDescription}
          />
        </SettingsRow>
        <SettingsRow title={strings.phone} control="field">
          <Field
            label={strings.phone}
            isLabelHidden
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            value={phone}
            onChange={setPhone}
          />
        </SettingsRow>
        <SettingsRow title={strings.email} control="field">
          <Field
            label={strings.email}
            isLabelHidden
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={setEmail}
          />
        </SettingsRow>
        <SettingsRow title={strings.website} control="field">
          <Field
            label={strings.website}
            isLabelHidden
            name="website"
            type="url"
            autoComplete="url"
            maxLength={2048}
            value={website}
            onChange={setWebsite}
          />
        </SettingsRow>
      </Form>
    </Card>
  );
}

const PLACE_FIELDS = ['name', 'country', 'timeZone'] as const;

/** Add place: a name, a country and a time zone; hours and tables follow on its card. */
function AddPlaceDialog({
  isOpen,
  onOpenChange,
  timeZone: firstZone,
  country: firstCountry,
  onAdd,
}: {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly timeZone: string;
  readonly country: string | null;
  readonly onAdd: (fields: PlaceFields) => Promise<void>;
}) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [country, setCountry] = useState<string | null>(firstCountry);
  const [timeZone, setTimeZone] = useState(firstZone);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const zones = useMemo(() => zoneItems(timeZone, new Date()), [timeZone]);
  const add = () => {
    if (isBusy) return;
    if (name.trim() === '' || country === null) {
      setRefusals([
        ...(name.trim() === '' ? [{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'name' }] : []),
        ...(country === null
          ? [{ code: 'INPUT_INVALID', message: strings.countryMissing, attributeId: 'country' }]
          : []),
      ]);
      return;
    }
    setBusy(true);
    setRefusals([]);
    onAdd({ name: name.trim(), country, timeZone }).then(
      () => {
        setBusy(false);
        setName('');
        onOpenChange(false);
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, PLACE_FIELDS));
      },
    );
  };
  return (
    <Modal
      title={strings.newPlace}
      variant="window"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {strings.add}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={add}
        label={strings.newPlace}
        focusesFirstField
      >
        <Field label={strings.placeName} name="name" isRequired maxLength={80} value={name} onChange={setName} />
        <CountryPicker label={strings.country} list="all" isRequired value={country} onChange={setCountry} />
        <Select
          label={strings.timeZone}
          items={zones}
          filter={zoneMatches}
          isSearchable
          value={timeZone}
          onChange={(zone) => {
            if (zone !== null) setTimeZone(zone);
          }}
        />
      </Form>
    </Modal>
  );
}
