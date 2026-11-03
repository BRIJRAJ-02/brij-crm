// Brief
// Purpose: Settings › Business › Page (spec 0066, B4 lite): the business's public page, its address and what it shows.
// Main task: claim the address, add photos and About, then Publish; every change waits in a draft until then.
// Leaves out: the name, kind, one line and contact (Business), the hours and address (each place), the menu (the Menu
// app), the look (Settings › Brand), reviews and services (later slices).
//
// Foolproof (spec 0068): one next action per empty state, and Publish refuses a page that would be broken with one
// line saying what to fix and a link to it. The address and a place's address are claimed at once (they must be held
// before they are shared); photos, About, amenities and search listing are the draft.
import type {
  BusinessAmenity,
  BusinessPageContent,
  BusinessPageStore,
  BusinessPageView,
  BusinessPhoto,
  DataError,
} from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  BusinessGallery,
  Button,
  ButtonLink,
  Callout,
  Card,
  ChoiceChips,
  CopyButton,
  EmptyState,
  Field,
  FileDrop,
  Form,
  Modal,
  SettingsRow,
  SettingsSection,
  Skeleton,
  Switch,
  useFormatSettings,
  type Toasts,
} from '@crm/ui';
import { useId, useState } from 'react';
import { publicBookingOrigin } from '../booking/links.ts';
import { businessSettingsHref, placeTablesHref } from '../settings/nav.ts';
import { SettingsMissing, SettingsPage } from '../settings/SettingsPage.tsx';
import { pageStrings as words } from './business-page-strings.ts';
import { PHOTO_PICK_MAX_BYTES, PHOTO_TYPES, pickGalleryPhoto } from './business-photos.ts';
import { strings } from './strings.ts';

/** The amenities' closed list and their words, in the order the page lists them. */
const AMENITIES: readonly { readonly id: BusinessAmenity; readonly label: string }[] = [
  { id: 'wifi', label: 'Wi‑Fi' },
  { id: 'parking', label: 'Parking' },
  { id: 'wheelchair', label: 'Wheelchair access' },
  { id: 'cards', label: 'Card payments' },
  { id: 'kids', label: 'Kids friendly' },
  { id: 'outdoor', label: 'Outdoor seating' },
  { id: 'pets', label: 'Pets welcome' },
  { id: 'air_conditioning', label: 'Air conditioning' },
  { id: 'vegetarian', label: 'Vegetarian options' },
  { id: 'private_dining', label: 'Private dining' },
];

/** The most photos the page shows. */
const PHOTOS_MAX = 20;

/** Props for the page editor. */
export interface BusinessPageScreenProps {
  readonly store: BusinessPageStore;
  readonly slug: string;
  readonly toasts: Toasts;
}

/** Settings › Business › Page. */
export function BusinessPageScreen({ store, slug, toasts }: BusinessPageScreenProps) {
  const state = useHospitality(store.held(slug));
  const [isPublishing, setPublishing] = useState(false);
  const [isDiscarding, setDiscarding] = useState(false);
  const crumbs = [{ id: 'business', label: strings.businessTitle, href: businessSettingsHref(slug) }];
  if (state.status === 'error' && state.error.code === 'FORBIDDEN') return <SettingsMissing backTo="home" />;
  if (state.status === 'error') {
    return (
      <SettingsPage title={words.title} crumbs={crumbs}>
        <EmptyState
          title={state.error.code === 'APP_NOT_INSTALLED' ? strings.notInstalled : strings.failed}
          icon="store"
          actions={<Button onPress={() => store.held(slug).retry()}>{strings.retry}</Button>}
        />
      </SettingsPage>
    );
  }
  if (state.status === 'loading') {
    return (
      <SettingsPage title={words.title} crumbs={crumbs}>
        <Card isBusy>
          <Skeleton shape="field" />
        </Card>
      </SettingsPage>
    );
  }
  const view = state.value;
  const address = view.handle === undefined ? undefined : `${publicBookingOrigin()}/${view.handle}`;
  /** Saves the draft with one part changed; a refusal says so and the copy goes back. */
  const saveDraft = async (next: Partial<BusinessPageContent>) => {
    const refused = await store.saveDraft(slug, { ...view.draft, ...next });
    if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message || words.saveFailed });
  };
  const publish = async () => {
    setPublishing(true);
    const refused = await store.publish(slug);
    setPublishing(false);
    if (refused === undefined) toasts.toast({ tone: 'success', message: words.published });
    else toasts.toast({ tone: 'danger', message: refused.message });
  };
  return (
    <SettingsPage
      title={words.title}
      crumbs={crumbs}
      meta={<PublishStatus view={view} />}
      actions={
        <>
          {address !== undefined && view.published !== undefined && (
            <ButtonLink href={address} isExternal icon="external-link" label={words.viewNewTab}>
              {words.view}
            </ButtonLink>
          )}
          {view.published !== undefined && view.hasChanges && (
            <Button onPress={() => setDiscarding(true)}>{words.discard}</Button>
          )}
          <Button
            variant="primary"
            isDisabled={view.problem !== undefined || (!view.hasChanges && view.published !== undefined)}
            isPending={isPublishing}
            onPress={() => void publish()}
          >
            {isPublishing ? words.publishing : words.publish}
          </Button>
        </>
      }
    >
      {view.problem !== undefined && view.handle !== undefined && (
        <Callout
          tone="warning"
          title={words.fixFirst}
          actions={
            <ButtonLink
              href={
                view.problem.placeId === undefined
                  ? businessSettingsHref(slug)
                  : placeTablesHref(slug, view.problem.placeId)
              }
            >
              {view.problem.placeId === undefined ? words.fixInBusiness : words.fixPlace}
            </ButtonLink>
          }
        >
          {view.problem.message}
        </Callout>
      )}
      {view.hasChanges && view.published !== undefined && view.changes.length > 0 && (
        <Callout tone="info" title={words.changes(view.changes.length)}>
          {view.changes.join(' · ')}
        </Callout>
      )}
      <AddressSection
        // A new address (another tab's, or this one's answer) starts the field again from it.
        key={view.handle ?? ''}
        view={view}
        address={address}
        onClaim={async (handle) => {
          const refused = await store.claimHandle(slug, handle);
          if (refused === undefined) toasts.toast({ tone: 'success', message: words.claimed });
          return refused;
        }}
      />
      {view.handle !== undefined && (
        <>
          <PhotosSection store={store} slug={slug} view={view} toasts={toasts} onSave={saveDraft} />
          <AboutSection view={view} onSave={saveDraft} />
          <PlacesSection
            view={view}
            onSlug={async (placeId, next) => {
              const refused = await store.setPlaceSlug(slug, placeId, next);
              if (refused === undefined) toasts.toast({ tone: 'success', message: words.placeAddressSaved });
              return refused;
            }}
            onHidden={(placeId, isHidden) =>
              void saveDraft({
                hiddenPlaces: isHidden
                  ? [...view.draft.hiddenPlaces.filter((id) => id !== placeId), placeId]
                  : view.draft.hiddenPlaces.filter((id) => id !== placeId),
              })
            }
          />
          {(view.showsMenu || view.showsReserve) && (
            <SettingsSection title={words.shows}>
              <Card>
                {view.showsMenu && <SettingsRow title={words.showsMenu} />}
                {view.showsReserve && <SettingsRow title={words.showsReserve} />}
              </Card>
            </SettingsSection>
          )}
        </>
      )}
      <Modal
        title={words.discardAsk}
        variant="confirm"
        isOpen={isDiscarding}
        onOpenChange={setDiscarding}
        actions={
          <>
            <Button slot="close">{words.keepEditing}</Button>
            <Button
              variant="primary"
              onPress={() => {
                setDiscarding(false);
                void store.discard(slug).then((refused) => {
                  toasts.toast(
                    refused === undefined
                      ? { tone: 'success', message: words.discarded }
                      : { tone: 'danger', message: refused.message },
                  );
                });
              }}
            >
              {words.discard}
            </Button>
          </>
        }
      >
        {words.discardText}
      </Modal>
    </SettingsPage>
  );
}

/** "Live · 2 changes not published", "Not published yet". */
function PublishStatus({ view }: { readonly view: BusinessPageView }) {
  const { locale } = useFormatSettings();
  if (view.published === undefined) return <>{words.notPublished}</>;
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(view.published.at));
  return <>{view.hasChanges ? words.changes(view.changes.length || 1) : words.publishedOn(date)}</>;
}

/** The page's address: claimed at once, copied once it has one. */
function AddressSection({
  view,
  address,
  onClaim,
}: {
  readonly view: BusinessPageView;
  readonly address: string | undefined;
  readonly onClaim: (handle: string) => Promise<DataError | undefined>;
}) {
  const formId = useId();
  const [handle, setHandle] = useState(view.handle ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const changed = handle.trim().toLowerCase() !== (view.handle ?? '');
  const claim = () => {
    if (isBusy || !changed) return;
    setBusy(true);
    setError(undefined);
    void onClaim(handle.trim().toLowerCase()).then((refused) => {
      setBusy(false);
      if (refused !== undefined) setError(refused.message);
    });
  };
  const host = publicBookingOrigin().replace(/^https?:\/\//, '');
  return (
    <SettingsSection title={words.address} description={words.addressText}>
      <Card
        footer={
          <Button variant="primary" type="submit" form={formId} isDisabled={!changed} isPending={isBusy}>
            {isBusy ? words.claiming : words.claim}
          </Button>
        }
      >
        {view.handle === undefined && (
          <Callout tone="info" title={words.firstAddress}>
            {words.firstAddressText}
          </Callout>
        )}
        <Form id={formId} onSubmit={claim} label={words.address} isBusy={isBusy}>
          <Field
            label={words.handle}
            name="handle"
            prefix={`${host}/`}
            value={handle}
            onChange={(next) => {
              setHandle(next);
              setError(undefined);
            }}
            maxLength={40}
            autoComplete="off"
            {...(error === undefined ? {} : { error })}
            {...(address === undefined ? {} : { after: <CopyButton value={address} label={words.copyAddress} /> })}
          />
        </Form>
      </Card>
    </SettingsSection>
  );
}

/** The gallery: add, describe, order and remove photos; the preview draws it as guests will see it. */
function PhotosSection({
  store,
  slug,
  view,
  toasts,
  onSave,
}: {
  readonly store: BusinessPageStore;
  readonly slug: string;
  readonly view: BusinessPageView;
  readonly toasts: Toasts;
  readonly onSave: (next: Partial<BusinessPageContent>) => Promise<void>;
}) {
  const [sending, setSending] = useState(0);
  const photos = view.draft.gallery;
  const room = PHOTOS_MAX - photos.length;
  const save = (gallery: readonly BusinessPhoto[]) => void onSave({ gallery: [...gallery] });
  const add = async (files: readonly File[]) => {
    if (files.length > room) toasts.toast({ tone: 'info', message: words.photosRoom(room) });
    const picked = files.slice(0, Math.max(room, 0));
    setSending((was) => was + picked.length);
    const added: BusinessPhoto[] = [];
    for (const file of picked) {
      try {
        const prepared = await pickGalleryPhoto(file).catch(() => undefined);
        if (prepared === undefined) {
          toasts.toast({ tone: 'danger', message: words.photoUnreadable });
          continue;
        }
        const uploaded = await store.uploadPhoto(slug, prepared);
        if (uploaded.ok) added.push(uploaded.photo);
        else toasts.toast({ tone: 'danger', message: uploaded.error.message || words.photoFailed });
      } finally {
        setSending((was) => was - 1);
      }
    }
    if (added.length > 0) save([...photos, ...added]);
  };
  const move = (at: number, by: -1 | 1) => {
    const next = [...photos];
    const [moving] = next.splice(at, 1);
    if (moving === undefined) return;
    next.splice(at + by, 0, moving);
    save(next);
  };
  return (
    <SettingsSection title={words.photos} description={words.photosText}>
      <Card>
        {photos.length > 0 && (
          <BusinessGallery
            name={words.howItLooks}
            photos={photos.map((photo) => ({ ...photo, src: store.photoSrc(slug, photo.id) }))}
          />
        )}
        <FileDrop
          label={photos.length === 0 ? words.addFirstPhoto : words.addPhotos}
          acceptedTypes={PHOTO_TYPES}
          typesText={words.photoTypes}
          maxSize={PHOTO_PICK_MAX_BYTES}
          allowsMultiple
          isPending={sending > 0}
          isDisabled={room <= 0}
          onFiles={(files) => void add(files)}
        />
        {room <= 0 && <Callout tone="info">{words.photosFull}</Callout>}
        {photos.map((photo, at) => (
          <PhotoRow
            key={photo.id}
            photo={photo}
            at={at}
            count={photos.length}
            onAlt={(alt) =>
              save(
                photos.map((each) =>
                  each.id === photo.id ? { ...each, ...(alt === '' ? { alt: undefined } : { alt }) } : each,
                ),
              )
            }
            onMove={(by) => move(at, by)}
            onRemove={() => save(photos.filter((each) => each.id !== photo.id))}
          />
        ))}
      </Card>
    </SettingsSection>
  );
}

/** One photo's description, saved when the field is left, with its move and remove buttons. */
function PhotoRow({
  photo,
  at,
  count,
  onAlt,
  onMove,
  onRemove,
}: {
  readonly photo: BusinessPhoto;
  readonly at: number;
  readonly count: number;
  readonly onAlt: (alt: string) => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const [alt, setAlt] = useState(photo.alt ?? '');
  return (
    <Field
      label={words.photoAlt(at + 1)}
      hint={at === 0 ? words.photoAltHint : undefined}
      name={`alt-${String(at)}`}
      autoComplete="off"
      maxLength={120}
      value={alt}
      onChange={setAlt}
      onBlur={() => {
        if (alt.trim() !== (photo.alt ?? '')) onAlt(alt.trim());
      }}
      after={
        <>
          {at > 0 && <Button variant="ghost" icon="arrow-up" label={words.moveUp(at + 1)} onPress={() => onMove(-1)} />}
          {at < count - 1 && (
            <Button variant="ghost" icon="arrow-down" label={words.moveDown(at + 1)} onPress={() => onMove(1)} />
          )}
          <Button variant="ghost" icon="trash" label={words.removePhoto(at + 1)} onPress={onRemove} />
        </>
      }
    />
  );
}

/** About and amenities: the text saves when the field is left, an amenity at once. */
function AboutSection({
  view,
  onSave,
}: {
  readonly view: BusinessPageView;
  readonly onSave: (next: Partial<BusinessPageContent>) => Promise<void>;
}) {
  const [about, setAbout] = useState(view.draft.about ?? '');
  return (
    <SettingsSection title={words.about} description={words.aboutText}>
      <Card>
        <Field
          label={words.aboutLabel}
          name="about"
          isMultiline
          maxLength={1000}
          showCounter
          value={about}
          onChange={setAbout}
          onBlur={() => {
            if (about.trim() !== (view.draft.about ?? '')) {
              void onSave(about.trim() === '' ? { about: undefined } : { about: about.trim() });
            }
          }}
        />
        <ChoiceChips
          label={words.amenities}
          choices={AMENITIES}
          selected={view.draft.amenities}
          onChange={(selected) =>
            void onSave({
              amenities: AMENITIES.flatMap((amenity) => (selected.includes(amenity.id) ? [amenity.id] : [])),
            })
          }
        />
      </Card>
    </SettingsSection>
  );
}

/** Each place's address on the page, and whether search engines list it. */
function PlacesSection({
  view,
  onSlug,
  onHidden,
}: {
  readonly view: BusinessPageView;
  readonly onSlug: (placeId: string, slug: string) => Promise<DataError | undefined>;
  readonly onHidden: (placeId: string, isHidden: boolean) => void;
}) {
  return (
    <SettingsSection title={words.places} description={words.placesText}>
      <Card>
        {view.places.map((place) => (
          <PlaceRow
            key={`${place.id}:${place.slug ?? ''}`}
            name={place.name}
            slug={place.slug}
            handle={view.handle ?? ''}
            isHidden={view.draft.hiddenPlaces.includes(place.id)}
            onSlug={(next) => onSlug(place.id, next)}
            onHidden={(isHidden) => onHidden(place.id, isHidden)}
          />
        ))}
      </Card>
    </SettingsSection>
  );
}

/** One place: its address field (saved with Save) and its search listing switch. */
function PlaceRow({
  name,
  slug,
  handle,
  isHidden,
  onSlug,
  onHidden,
}: {
  readonly name: string;
  readonly slug: string | undefined;
  readonly handle: string;
  readonly isHidden: boolean;
  readonly onSlug: (slug: string) => Promise<DataError | undefined>;
  readonly onHidden: (isHidden: boolean) => void;
}) {
  const [value, setValue] = useState(slug ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const changed = value.trim().toLowerCase() !== (slug ?? '') && value.trim() !== '';
  return (
    <>
      <SettingsRow
        title={name}
        description={slug === undefined ? words.noSlug : words.placePath(handle, slug)}
        control="field"
      >
        <Field
          label={words.placeAddress(name)}
          isLabelHidden
          name={`slug-${name}`}
          prefix="/"
          value={value}
          maxLength={60}
          autoComplete="off"
          onChange={(next) => {
            setValue(next);
            setError(undefined);
          }}
          {...(error === undefined ? {} : { error })}
          after={
            <Button
              isDisabled={!changed}
              isPending={isBusy}
              onPress={() => {
                setBusy(true);
                void onSlug(value.trim().toLowerCase()).then((refused) => {
                  setBusy(false);
                  if (refused !== undefined) setError(refused.message);
                });
              }}
            >
              {words.savePlaceAddress}
            </Button>
          }
        />
      </SettingsRow>
      <SettingsRow title={words.hidden} description={words.hiddenText}>
        <Switch
          label={words.hiddenLabel(name)}
          isLabelHidden
          isSelected={!isHidden}
          onChange={(isListed) => onHidden(!isListed)}
        />
      </SettingsRow>
    </>
  );
}
