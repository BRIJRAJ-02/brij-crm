// Brief
// Purpose: Settings › Business › Page (spec 0066, B4 lite): the business's public page, its address and what it shows.
// Main task: claim the address, add photos and About, then Publish; every change waits in a draft until then.
// Leaves out: the name, kind, one line and contact (Business), the hours and address (each place), the menu (the Menu
// app), the look (Settings › Brand), reviews and services (later slices).
//
// Foolproof (spec 0068): one next action per empty state, and Publish refuses a page that would be broken with one
// line saying what to fix and a link to it. The address and a place's address are claimed at once (they must be held
// before they are shared); photos, About, amenities and search listing are the draft. An empty workspace's address
// starts as the business's name. Typed text saves a moment after the typing stops (and when the field is left, and
// when the screen goes), each change made on the draft as it stands, and Publish sends what is still being typed first
// and goes out behind it. Removing a photo offers Undo.
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
  Avatar,
  BusinessGallery,
  Button,
  ButtonLink,
  Callout,
  Card,
  ChoiceChips,
  CopyButton,
  EditorStatus,
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
  usePhotoCrop,
  type Toasts,
} from '@crm/ui';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { publicBookingOrigin } from '../booking/links.ts';
import {
  brandSettingsHref,
  businessSettingsHref,
  placeTablesHref,
  servicesSettingsHref,
  shiftsSettingsHref,
  staffSettingsHref,
} from '../settings/nav.ts';
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

/** How long after the last keystroke typed text saves. */
const TYPING_SAVE_MS = 600;

/** How long Undo stays on a removed photo's toast. */
const UNDO_MS = 10_000;

/**
 * The screen's typed text that hasn't gone out yet: each field registers how to send its own, so Publish (and leaving
 * the tab) can send it all first. `isTyping` is true while any field holds unsent text.
 */
interface DraftTexts {
  readonly register: (flush: () => boolean) => () => void;
  readonly typing: () => void;
  readonly flushAll: () => boolean;
}

/** The screen's registry of typed text (one per screen). */
function useDraftTexts(): DraftTexts & { readonly isTyping: boolean } {
  const flushers = useRef(new Set<() => boolean>());
  const [isTyping, setTyping] = useState(false);
  const texts = useMemo<DraftTexts>(
    () => ({
      register: (flush) => {
        flushers.current.add(flush);
        return () => {
          flushers.current.delete(flush);
        };
      },
      typing: () => {
        setTyping(true);
      },
      flushAll: () => {
        let sent = false;
        for (const flush of flushers.current) sent = flush() || sent;
        setTyping(false);
        return sent;
      },
    }),
    [],
  );
  // Closing or reloading the tab sends what was typed, and asks to stay while it is on its way.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (texts.flushAll()) event.preventDefault();
    };
    globalThis.addEventListener('beforeunload', onLeave);
    return () => {
      globalThis.removeEventListener('beforeunload', onLeave);
    };
  }, [texts]);
  return { ...texts, isTyping };
}

/**
 * One typed text of the draft: shown as typed, saved `TYPING_SAVE_MS` after the typing stops, at once when the field
 * is left, when Publish asks, and when the screen goes (so leaving never drops it). A new saved value (Discard, another
 * tab) replaces the field's while nothing typed is waiting.
 */
function useDraftText(saved: string, save: (text: string) => void, texts: DraftTexts) {
  const [text, setText] = useState(saved);
  const [seen, setSeen] = useState(saved);
  // Whether typed text is waiting to go out (state, for the render; the text itself rides the ref, for the timer).
  const [isUnsent, setUnsent] = useState(false);
  const unsent = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  const savedRef = useRef(saved);
  useEffect(() => {
    saveRef.current = save;
    savedRef.current = saved;
  });
  // A saved value that is only what was typed, trimmed (its own save landing mid sentence), never takes the trailing
  // space the person is about to type after.
  if (saved !== seen) {
    setSeen(saved);
    if (!isUnsent && saved !== text.trim()) setText(saved);
  }
  const flush = useCallback((): boolean => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    const next = unsent.current;
    unsent.current = undefined;
    setUnsent(false);
    if (next === undefined || next.trim() === savedRef.current) return false;
    saveRef.current(next.trim());
    return true;
  }, []);
  useEffect(() => {
    const forget = texts.register(flush);
    return () => {
      forget();
      // The screen going (another page, another tab of Settings) sends what was typed.
      flush();
    };
  }, [texts, flush]);
  const onChange = (next: string) => {
    setText(next);
    unsent.current = next;
    setUnsent(true);
    texts.typing();
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(flush, TYPING_SAVE_MS);
  };
  return { text, onChange, onBlur: flush };
}

/** Props for the page editor. */
export interface BusinessPageScreenProps {
  readonly store: BusinessPageStore;
  readonly slug: string;
  readonly toasts: Toasts;
}

/** Settings › Business › Page. */
export function BusinessPageScreen({ store, slug, toasts }: BusinessPageScreenProps) {
  const state = useHospitality(store.held(slug));
  const texts = useDraftTexts();
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
  /**
   * Changes the draft as it stands when the change goes out (never as this render drew it, so a photo landing while a
   * description saves keeps both); a refusal says so and the copy goes back.
   */
  const changeDraft = async (edit: (draft: BusinessPageContent) => BusinessPageContent) => {
    const refused = await store.changeDraft(slug, edit);
    if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message || words.saveFailed });
  };
  const publish = async () => {
    // What is still being typed goes out first; Publish is queued behind it, so it publishes the last keystroke.
    texts.flushAll();
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
            // On a phone the bar keeps Publish in view: View page and Discard drop their words for their icons.
            <ButtonLink href={address} isExternal icon="external-link" label={words.viewNewTab} isLabelCollapsible>
              {words.view}
            </ButtonLink>
          )}
          {view.published !== undefined && view.hasChanges && (
            <Button icon="undo-2" label={words.discard} isLabelCollapsible onPress={() => setDiscarding(true)}>
              {words.discard}
            </Button>
          )}
          <Button
            variant="primary"
            isDisabled={
              view.problem !== undefined || (!view.hasChanges && !texts.isTyping && view.published !== undefined)
            }
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
                view.problem.fix === 'services'
                  ? servicesSettingsHref(slug)
                  : view.problem.fix === 'staff'
                    ? staffSettingsHref(slug)
                    : view.problem.fix === 'shifts'
                      ? shiftsSettingsHref(slug)
                      : view.problem.placeId === undefined
                        ? businessSettingsHref(slug)
                        : placeTablesHref(slug, view.problem.placeId)
              }
            >
              {view.problem.fix === 'services' || view.problem.fix === 'staff' || view.problem.fix === 'shifts'
                ? words.fixIt
                : view.problem.placeId === undefined
                  ? words.fixInBusiness
                  : words.fixPlace}
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
        key={view.handle ?? `suggested:${view.suggestedHandle ?? ''}`}
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
          <PhotosSection store={store} slug={slug} view={view} toasts={toasts} texts={texts} onChange={changeDraft} />
          <AboutSection view={view} texts={texts} onChange={changeDraft} />
          <SettingsSection title={words.look} description={words.lookText}>
            <Card>
              <SettingsRow title={words.logoAndColours} description={words.logoAndColoursText}>
                <ButtonLink href={brandSettingsHref(slug)}>{words.openBrand}</ButtonLink>
              </SettingsRow>
            </Card>
          </SettingsSection>
          <PlacesSection
            view={view}
            onSlug={async (placeId, next) => {
              const refused = await store.setPlaceSlug(slug, placeId, next);
              if (refused === undefined) toasts.toast({ tone: 'success', message: words.placeAddressSaved });
              return refused;
            }}
            onHidden={(placeId, isHidden) =>
              void changeDraft((draft) => ({
                ...draft,
                hiddenPlaces: isHidden
                  ? [...draft.hiddenPlaces.filter((id) => id !== placeId), placeId]
                  : draft.hiddenPlaces.filter((id) => id !== placeId),
              }))
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
              variant="danger-solid"
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

/** "Published Nov 4", "2 changes not published", "Not published yet", with its dot. */
function PublishStatus({ view }: { readonly view: BusinessPageView }) {
  const { locale } = useFormatSettings();
  // The editors' one status (a StatusDot with a short word on a phone), as the Form and Page editors show theirs.
  if (view.published === undefined) return <EditorStatus tone="draft" text={words.notPublished} />;
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(view.published.at));
  return view.hasChanges ? (
    <EditorStatus tone="changed" text={words.changes(view.changes.length || 1)} />
  ) : (
    <EditorStatus tone="live" text={words.publishedOn(date)} />
  );
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
  // An empty workspace starts from the business's name as an address, free to claim; one press claims it.
  const [handle, setHandle] = useState(view.handle ?? view.suggestedHandle ?? '');
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
        // Claim shows only while the field says something new: a claimed address has nothing to press.
        {...(changed || isBusy
          ? {
              footer: (
                <Button type="submit" form={formId} isPending={isBusy}>
                  {isBusy ? words.claiming : words.claim}
                </Button>
              ),
            }
          : {})}
      >
        {view.handle === undefined && (
          <Callout tone="info" title={words.firstAddress}>
            {view.suggestedHandle === undefined ? words.firstAddressText : words.suggestedAddressText}
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
  texts,
  onChange,
}: {
  readonly store: BusinessPageStore;
  readonly slug: string;
  readonly view: BusinessPageView;
  readonly toasts: Toasts;
  readonly texts: DraftTexts;
  readonly onChange: (edit: (draft: BusinessPageContent) => BusinessPageContent) => Promise<void>;
}) {
  const [sending, setSending] = useState(0);
  const cropping = usePhotoCrop();
  const photos = view.draft.gallery;
  const room = PHOTOS_MAX - photos.length;
  /** Changes the gallery as it stands when the change goes out. */
  const changeGallery = (edit: (gallery: readonly BusinessPhoto[]) => readonly BusinessPhoto[]) =>
    void onChange((draft) => ({ ...draft, gallery: [...edit(draft.gallery)] }));
  /** Removes a photo, with Undo putting it back where it was (while there is room for it). */
  const remove = (photo: BusinessPhoto, at: number) => {
    changeGallery((gallery) => gallery.filter((each) => each.id !== photo.id));
    toasts.toast(
      {
        tone: 'info',
        message: words.photoRemoved,
        action: {
          label: words.undo,
          onAction: () => {
            changeGallery((gallery) => {
              if (gallery.some((each) => each.id === photo.id) || gallery.length >= PHOTOS_MAX) return gallery;
              const next = [...gallery];
              next.splice(Math.min(at, next.length), 0, photo);
              return next;
            });
          },
        },
      },
      { timeout: UNDO_MS },
    );
  };
  const add = async (files: readonly File[]) => {
    if (files.length > room) toasts.toast({ tone: 'info', message: words.photosRoom(room) });
    const picked = files.slice(0, Math.max(room, 0));
    setSending((was) => was + picked.length);
    const added: BusinessPhoto[] = [];
    for (const file of picked) {
      try {
        // Each photo is cropped as it is added (spec 0068, AC-6809); Cancel leaves that one out.
        const crop = await cropping.crop(file, 'free');
        if (crop === undefined) continue;
        const prepared = await pickGalleryPhoto(file, crop).catch(() => undefined);
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
    if (added.length > 0) changeGallery((gallery) => [...gallery, ...added].slice(0, PHOTOS_MAX));
  };
  /** Crops a photo already in the gallery again: a new picture in its place, its description kept. */
  const recrop = async (photo: BusinessPhoto) => {
    const source = store.photoSrc(slug, photo.id);
    const crop = await cropping.crop(source, 'free');
    if (crop === undefined) return;
    setSending((was) => was + 1);
    try {
      const prepared = await pickGalleryPhoto(source, crop).catch(() => undefined);
      if (prepared === undefined) {
        toasts.toast({ tone: 'danger', message: words.photoUnreadable });
        return;
      }
      const uploaded = await store.uploadPhoto(slug, prepared);
      if (!uploaded.ok) {
        toasts.toast({ tone: 'danger', message: uploaded.error.message || words.photoFailed });
        return;
      }
      const { alt } = photo;
      changeGallery((gallery) =>
        gallery.map((each) =>
          each.id === photo.id ? { ...uploaded.photo, ...(alt === undefined ? {} : { alt }) } : each,
        ),
      );
    } finally {
      setSending((was) => was - 1);
    }
  };
  const move = (id: string, by: -1 | 1) => {
    changeGallery((gallery) => {
      const at = gallery.findIndex((each) => each.id === id);
      if (at < 0 || at + by < 0 || at + by >= gallery.length) return gallery;
      const next = [...gallery];
      const [moving] = next.splice(at, 1);
      if (moving === undefined) return gallery;
      next.splice(at + by, 0, moving);
      return next;
    });
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
        {cropping.cropper}
        {room <= 0 && <Callout tone="info">{words.photosFull}</Callout>}
        {photos.map((photo, at) => (
          <PhotoRow
            key={photo.id}
            photo={photo}
            src={store.photoSrc(slug, photo.id)}
            at={at}
            count={photos.length}
            texts={texts}
            onAlt={(alt) =>
              changeGallery((gallery) =>
                gallery.map((each) => {
                  if (each.id !== photo.id) return each;
                  const { alt: _was, ...rest } = each;
                  return alt === '' ? rest : { ...rest, alt };
                }),
              )
            }
            onMove={(by) => move(photo.id, by)}
            onAdjust={() => void recrop(photo)}
            isSending={sending > 0}
            onRemove={() => remove(photo, at)}
          />
        ))}
      </Card>
    </SettingsSection>
  );
}

/**
 * One photo: its thumbnail, so the description is written looking at the picture, the description (saved as typed),
 * and its move and remove buttons.
 */
function PhotoRow({
  photo,
  src,
  at,
  count,
  texts,
  onAlt,
  onMove,
  onAdjust,
  isSending,
  onRemove,
}: {
  readonly photo: BusinessPhoto;
  readonly src: string;
  readonly at: number;
  readonly count: number;
  readonly texts: DraftTexts;
  readonly onAlt: (alt: string) => void;
  readonly onMove: (by: -1 | 1) => void;
  /** Crops the photo again. */
  readonly onAdjust: () => void;
  readonly isSending: boolean;
  readonly onRemove: () => void;
}) {
  const alt = useDraftText(photo.alt ?? '', onAlt, texts);
  return (
    <SettingsRow
      title={words.photoTitle(at + 1)}
      description={at === 0 ? words.photoLeads : undefined}
      leading={<Avatar name={words.photoTitle(at + 1)} src={src} shape="square" size="title" isDecorative />}
      leadingAlign="center"
      control="field"
    >
      <Field
        label={words.photoAlt(at + 1)}
        isLabelHidden
        placeholder={words.photoAltPlaceholder}
        name={`alt-${photo.id}`}
        autoComplete="off"
        maxLength={120}
        value={alt.text}
        onChange={alt.onChange}
        onBlur={alt.onBlur}
        after={
          <>
            {/* Both arrows on every row, the end ones disabled, so every row's field and buttons line up. */}
            <Button
              variant="ghost"
              icon="arrow-up"
              label={words.moveUp(at + 1)}
              isDisabled={at === 0}
              onPress={() => onMove(-1)}
            />
            <Button
              variant="ghost"
              icon="arrow-down"
              label={words.moveDown(at + 1)}
              isDisabled={at >= count - 1}
              onPress={() => onMove(1)}
            />
            <Button
              variant="ghost"
              icon="pencil"
              label={words.adjustPhoto(at + 1)}
              isDisabled={isSending}
              onPress={onAdjust}
            />
            <Button variant="ghost" icon="trash" label={words.removePhoto(at + 1)} onPress={onRemove} />
          </>
        }
      />
    </SettingsRow>
  );
}

/** About and amenities: the text saves as typed, an amenity at once. */
function AboutSection({
  view,
  texts,
  onChange,
}: {
  readonly view: BusinessPageView;
  readonly texts: DraftTexts;
  readonly onChange: (edit: (draft: BusinessPageContent) => BusinessPageContent) => Promise<void>;
}) {
  const about = useDraftText(
    view.draft.about ?? '',
    (text) =>
      void onChange((draft) => {
        const { about: _was, ...rest } = draft;
        return text === '' ? rest : { ...rest, about: text };
      }),
    texts,
  );
  return (
    <SettingsSection title={words.about} description={words.aboutText}>
      <Card>
        <Field
          label={words.aboutLabel}
          name="about"
          isMultiline
          maxLength={1000}
          showCounter
          value={about.text}
          onChange={about.onChange}
          onBlur={about.onBlur}
        />
        <ChoiceChips
          label={words.amenities}
          choices={AMENITIES}
          selected={view.draft.amenities}
          onChange={(selected) =>
            void onChange((draft) => ({
              ...draft,
              amenities: AMENITIES.flatMap((amenity) => (selected.includes(amenity.id) ? [amenity.id] : [])),
            }))
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
