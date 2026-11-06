// Brief
// Purpose: one item of the Menu app (spec 0065, AC-6522, AC-6523, AC-6527) in a drawer, in the order a person fills it:
// name, description, price (one price, sizes or a price text, one clear choice), photo; then what is in it (allergens,
// diet and spice, each a closed dropdown that says what is chosen); then add-ons, calories, Available and Popular.
// Main task: get an item right in one go and save it, the way guests will read it, then the next (Add another).
// Leaves out: where the item sits (the section's own Add item and Take out), and a serving size (the model has none).
import type { MenuDraft, MenuItem, MenuStore } from '@crm/data';
import { EU_ALLERGENS, MENU_LIMITS } from '@crm/data/menu';
import {
  Button,
  Callout,
  Field,
  FileDrop,
  Form,
  FormRow,
  SegmentedControl,
  Select,
  Separator,
  Switch,
  usePhotoCrop,
  type Toasts,
} from '@crm/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { DrawerForm } from './drawer.tsx';
import { GroupDrawer } from './GroupDrawer.tsx';
import {
  dietNotes,
  findsAllergen,
  hasChanged,
  itemFields,
  itemForm,
  itemProblems,
  NO_SPICE,
  placeChoices,
  PLAIN_DIET_MARKS,
  SPICE_MARKS,
  withContains,
  withPriceKind,
  type ItemForm,
  type PriceKind,
} from './item-form.ts';
import { draftPhotoHref, prepareMenuPhoto } from './photo.ts';
import { flipSoldOut } from './StructureTab.tsx';
import { strings } from './strings.ts';

/** A new item left out of every section. */
const NOWHERE = 'nowhere';

const dietLabel = (mark: string): string => strings.diets[mark as keyof typeof strings.diets];
const allergenLabel = (code: string): string => strings.allergens[code as keyof typeof strings.allergens];

/** The dish's form: a new one (placed at the end of `sectionId`) or one already made. */
export function ItemDialog({
  store,
  slug,
  draft,
  item,
  sectionId,
  newName,
  toasts,
  isAddingMore,
  onAddingMoreChange,
  onClose,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly item?: MenuItem;
  readonly sectionId?: string;
  readonly newName?: string;
  readonly toasts: Toasts;
  /** Add another: each save starts the next new item with the sheet still open (New record's Create more). */
  readonly isAddingMore: boolean;
  readonly onAddingMoreChange: (next: boolean) => void;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const { currency } = draft;
  const [id, setId] = useState(() => item?.id ?? store.newId());
  // What the form opened with: what a change is measured from, and what Add another starts over from.
  const [opened, setOpened] = useState<ItemForm>(() => itemForm(item, newName, currency));
  const [form, setForm] = useState<ItemForm>(opened);
  const change = (patch: Partial<ItemForm>) => setForm((was) => ({ ...was, ...patch }));
  // A new item made outside any section (the Items tab) says where it goes; a run of them keeps the choice.
  const [placedIn, setPlacedIn] = useState(NOWHERE);
  // Counts the items added, so the form starts afresh, its first field focused.
  const [round, setRound] = useState(0);
  // New add-on opens its drawer over this one, then comes back here with it picked.
  const [isMakingGroup, setMakingGroup] = useState(false);
  // Problems show from the first Save tried, and each one goes the moment it is fixed. Each try that finds one goes to
  // it, so a Save never seems to do nothing when the problem is out of sight.
  const [refusedSaves, setRefusedSaves] = useState(0);
  const [hasTriedSaving, setTriedSaving] = useState(false);
  const [isSaving, setSaving] = useState(false);
  // A chosen photo waits for Save (a new dish's for the dish itself), so Cancel or Discard leaves the dish as it was.
  // It is cropped when chosen (spec 0068, AC-6809) and held drawn at both widths; the file it came from is kept, so
  // Adjust crop starts again from the whole photo. Remove waits for Save too.
  const [pendingPhoto, setPendingPhoto] = useState<{ readonly large: Blob; readonly small: Blob }>();
  const [pendingOriginal, setPendingOriginal] = useState<File>();
  const [isPhotoRemoved, setPhotoRemoved] = useState(false);
  const cropping = usePhotoCrop();
  // Its preview is a local object URL, let go when another photo replaces it or the drawer closes.
  const [pendingSrc, setPendingSrc] = useState<string>();
  const pendingSrcRef = useRef<string | undefined>(undefined);
  const letGoOfPreview = () => {
    if (pendingSrcRef.current !== undefined) URL.revokeObjectURL(pendingSrcRef.current);
    pendingSrcRef.current = undefined;
  };
  useEffect(() => letGoOfPreview, []);
  useEffect(() => {
    if (refusedSaves > 0) document.getElementById(formId)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refusedSaves, formId]);
  const live = draft.items.find((each) => each.id === id);
  // Run service alone reads a dish here and changes nothing (UX review should-fix 14).
  const isReadOnly = !draft.canEdit;
  const isNew = item === undefined;
  const hasPhotoChange = pendingPhoto !== undefined || isPhotoRemoved;
  const isDirty = hasPhotoChange || hasChanged(form, opened);
  const problems = hasTriedSaving ? itemProblems(form, currency) : {};
  const notes = dietNotes(form);
  const places = isNew && !isReadOnly && sectionId === undefined ? placeChoices(draft) : [];

  /** A refusal said as a toast (the item's own Undo and Available speak through the same). */
  const said = (refusedNow: { readonly message: string } | undefined) => {
    if (refusedNow !== undefined) toasts.toast({ tone: 'danger', message: refusedNow.message });
  };

  const save = async () => {
    const found = itemProblems(form, currency);
    setTriedSaving(true);
    if (Object.keys(found).length > 0) {
      setRefusedSaves((was) => was + 1);
      return;
    }
    const fields = itemFields(form, currency);
    // Busy until every part has gone (the item, its photo, Available), so a second Save sends nothing twice.
    setSaving(true);
    // Placed once: a Save tried again after a refused photo finds the item made.
    const place = sectionId ?? (placedIn === NOWHERE ? undefined : placedIn);
    const refused = await store.saveItem(slug, id, fields, isNew && live === undefined ? place : undefined);
    if (refused !== undefined) {
      setSaving(false);
      toasts.toast({ tone: 'danger', message: refused.message });
      return;
    }
    // The photo refused: the sheet stays, holding it, so Save can try it again.
    const photoRefused =
      pendingPhoto !== undefined
        ? await store.uploadPhoto(slug, id, pendingPhoto)
        : isPhotoRemoved
          ? await store.removePhoto(slug, id)
          : undefined;
    if (photoRefused !== undefined) {
      setSaving(false);
      said(photoRefused);
      return;
    }
    // Available changed (or a new item made unavailable): Sold out goes live at once, once the item exists, said
    // with Undo as the Items switch says it.
    if (form.isAvailable !== opened.isAvailable) {
      flipSoldOut(store, slug, { id, name: fields.name }, !form.isAvailable, toasts, said);
    }
    setSaving(false);
    if (!isNew || !isAddingMore) {
      onClose();
      return;
    }
    toasts.toast({ tone: 'success', message: strings.itemAdded(fields.name) });
    const next = itemForm(undefined, undefined, currency);
    letGoOfPreview();
    setId(store.newId());
    setOpened(next);
    setForm(next);
    setTriedSaving(false);
    setPendingPhoto(undefined);
    setPendingOriginal(undefined);
    setPendingSrc(undefined);
    setRound((was) => was + 1);
  };

  /** Opens the cropper on `source` in the dish's shape, then holds the part kept, drawn at both widths, for Save. */
  const cropPhoto = async (source: File | string) => {
    const crop = await cropping.crop(source, 'dish');
    if (crop === undefined) return;
    const photo = await prepareMenuPhoto(source, crop).catch(() => undefined);
    if (photo === undefined) {
      toasts.toast({ tone: 'danger', message: strings.photoFailed });
      return;
    }
    letGoOfPreview();
    const src = URL.createObjectURL(photo.small);
    pendingSrcRef.current = src;
    setPendingSrc(src);
    setPendingPhoto(photo);
    setPhotoRemoved(false);
    if (typeof source !== 'string') setPendingOriginal(source);
  };

  // Every dish keeps a chosen photo until Save (walk, 4 Nov 2026; UX review should-fix 8), cropped first.
  const choosePhoto = (files: readonly File[]) => {
    const file = files[0];
    if (file === undefined) return;
    void cropPhoto(file);
  };

  // What the sheet shows: the photo chosen, else the saved one unless it is being taken off.
  const savedPhoto = isPhotoRemoved ? undefined : live?.photo;
  // Adjust crop: the chosen file again, else the dish's saved photo at its large width (our own origin).
  const adjustSource =
    pendingOriginal ??
    (savedPhoto === undefined ? undefined : draftPhotoHref(slug, savedPhoto.id, 'large', savedPhoto.version));

  const canChooseMoreGroups = form.groupIds.length < MENU_LIMITS.groupsPerItem;

  return (
    <DrawerForm
      title={form.name.trim() === '' ? (item?.name ?? strings.newDish) : form.name}
      isDirty={!isReadOnly && isDirty}
      isBusy={isSaving}
      onClose={onClose}
      {...(isNew && !isReadOnly
        ? { footerStart: <Switch label={strings.addAnother} isSelected={isAddingMore} onChange={onAddingMoreChange} /> }
        : {})}
      actions={
        isReadOnly ? (
          <Button variant="primary" slot="close">
            {strings.close}
          </Button>
        ) : (
          <>
            {/* After a run of items, nothing is left to cancel: what was saved stays saved. */}
            <Button slot="close" isDisabled={isSaving}>
              {round > 0 && !isDirty ? strings.close : strings.cancel}
            </Button>
            <Button variant="primary" type="submit" form={formId} isPending={isSaving}>
              {strings.save}
            </Button>
          </>
        )
      }
    >
      <Form
        key={round}
        id={formId}
        focusesFirstField={isNew && !isReadOnly}
        isBusy={isSaving}
        onSubmit={() => (isReadOnly ? undefined : void save())}
      >
        {isReadOnly ? <Callout tone="info">{strings.readOnlyDish}</Callout> : null}
        <Field
          isReadOnly={isReadOnly}
          label={strings.dishName}
          placeholder={strings.namePlaceholder}
          value={form.name}
          onChange={(name) => change({ name })}
          isRequired
          maxLength={MENU_LIMITS.itemNameMax}
          error={problems.name}
        />
        <Field
          isReadOnly={isReadOnly}
          label={strings.description}
          value={form.description}
          onChange={(description) => change({ description })}
          isMultiline
          maxLength={400}
          showCounter
        />
        <PriceFields
          form={form}
          currency={currency}
          problems={problems}
          isReadOnly={isReadOnly}
          newKey={store.newId}
          onChange={setForm}
        />
        <FileDrop
          label={strings.photo}
          variant="photo"
          acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
          typesText={strings.photoTypes}
          maxSize={MENU_LIMITS.photoMaxBytes}
          onFiles={choosePhoto}
          isReadOnly={isReadOnly}
          {...(isReadOnly || adjustSource === undefined
            ? {}
            : {
                onAdjust: () => {
                  void cropPhoto(adjustSource);
                },
              })}
          {...(pendingSrc !== undefined || savedPhoto !== undefined
            ? {
                // Taking a photo off waits for Save, like choosing one, so Cancel still undoes it.
                onRemove: () => {
                  letGoOfPreview();
                  setPendingSrc(undefined);
                  setPendingPhoto(undefined);
                  setPendingOriginal(undefined);
                  setPhotoRemoved(live?.photo !== undefined);
                },
              }
            : {})}
          {...(pendingSrc !== undefined
            ? { preview: { src: pendingSrc, alt: '' } }
            : savedPhoto === undefined
              ? {}
              : { preview: { src: draftPhotoHref(slug, savedPhoto.id, 'small', savedPhoto.version), alt: '' } })}
        />
        <Separator />
        <FormRow>
          <Select
            label={strings.contains}
            selectionMode="multiple"
            showsMarks
            isSearchable
            searchLabel={strings.findAllergen}
            placeholder={strings.none}
            isReadOnly={isReadOnly}
            filter={findsAllergen}
            items={EU_ALLERGENS.map((code) => ({ id: code, label: allergenLabel(code), group: strings.contains }))}
            values={form.contains}
            onValuesChange={(contains) => setForm((was) => withContains(was, contains))}
          />
          {/* Contained can't also be may contain: said on the row, so an allergen never seems to be missing. */}
          <Select
            label={strings.mayContain}
            selectionMode="multiple"
            showsMarks
            isSearchable
            searchLabel={strings.findAllergen}
            placeholder={strings.none}
            isReadOnly={isReadOnly}
            filter={findsAllergen}
            items={EU_ALLERGENS.map((code) => ({
              id: code,
              label: allergenLabel(code),
              group: strings.mayContain,
              ...(form.contains.includes(code) ? { isDisabled: true, description: strings.inContains } : {}),
            }))}
            values={form.may}
            onValuesChange={(may) => change({ may })}
          />
        </FormRow>
        <FormRow>
          <Select
            label={strings.diet}
            selectionMode="multiple"
            showsMarks
            placeholder={strings.none}
            isReadOnly={isReadOnly}
            items={PLAIN_DIET_MARKS.map((mark) => ({ id: mark, label: dietLabel(mark) }))}
            values={form.diet}
            onValuesChange={(diet) => change({ diet })}
            {...(notes.length === 0 ? {} : { hint: notes.join(' ') })}
          />
          <Select
            label={strings.spice}
            showsMarks
            isReadOnly={isReadOnly}
            items={[
              { id: NO_SPICE, label: strings.none, isNothing: true },
              ...SPICE_MARKS.map((mark) => ({ id: mark, label: dietLabel(mark) })),
            ]}
            value={form.spice}
            onChange={(spice) => change({ spice: spice ?? NO_SPICE })}
          />
        </FormRow>
        <Separator />
        {places.length === 0 ? null : (
          <Select
            label={strings.placedIn}
            showsMarks
            isSearchable={places.length > 7}
            searchLabel={strings.placedIn}
            items={[{ id: NOWHERE, label: strings.notOnMenu, isNothing: true }, ...places]}
            value={placedIn}
            onChange={(next) => setPlacedIn(next ?? NOWHERE)}
          />
        )}
        <FormRow>
          {isReadOnly && draft.groups.length === 0 ? null : (
            // New add-on opens its drawer over this one and comes back with it picked, so nothing typed here is lost.
            <Select
              label={strings.groups}
              selectionMode="multiple"
              showsMarks
              placeholder={strings.none}
              isReadOnly={isReadOnly}
              isSearchable={draft.groups.length > 7}
              searchLabel={strings.findAddOn}
              items={draft.groups.map((group) => ({
                id: group.id,
                label: group.name,
                ...(canChooseMoreGroups || form.groupIds.includes(group.id)
                  ? {}
                  : { isDisabled: true, description: strings.groupsFull }),
              }))}
              values={form.groupIds}
              onValuesChange={(groupIds) => change({ groupIds })}
              onNew={{ label: strings.newOptionGroup, onPress: () => setMakingGroup(true) }}
            />
          )}
          <Field
            isReadOnly={isReadOnly}
            label={strings.kcal}
            value={form.kcal}
            onChange={(kcal) => change({ kcal })}
            inputMode="numeric"
            error={problems.kcal}
          />
        </FormRow>
        <FormRow>
          <Switch
            label={strings.availableSwitch}
            {...(isReadOnly ? { description: strings.availableNow } : {})}
            isSelected={form.isAvailable}
            onChange={(next) => {
              change({ isAvailable: next });
              // Run service changes nothing else here, so Available goes live at once for them, with Undo.
              if (isReadOnly && live !== undefined) flipSoldOut(store, slug, live, !next, toasts, said);
            }}
          />
          <Switch
            label={strings.featured}
            isSelected={form.featured}
            onChange={(featured) => change({ featured })}
            isReadOnly={isReadOnly}
          />
        </FormRow>
      </Form>
      {cropping.cropper}
      {isMakingGroup ? (
        <GroupDrawer
          store={store}
          slug={slug}
          draft={draft}
          toasts={toasts}
          onSaved={(groupId) =>
            setForm((was) => ({
              ...was,
              groupIds: [...was.groupIds, groupId].slice(0, MENU_LIMITS.groupsPerItem),
            }))
          }
          onClose={() => setMakingGroup(false)}
        />
      ) : null}
    </DrawerForm>
  );
}

/**
 * The item's one way of being priced: the choice sits on the line of the box it changes, after it, so Tab goes from
 * the price straight on. Sizes opens rows under it; only the kind chosen is saved.
 */
function PriceFields({
  form,
  currency,
  problems,
  isReadOnly,
  newKey,
  onChange,
}: {
  readonly form: ItemForm;
  readonly currency: string;
  readonly problems: Readonly<Record<string, string>>;
  readonly isReadOnly: boolean;
  readonly newKey: () => string;
  readonly onChange: (next: ItemForm) => void;
}) {
  const kinds = isReadOnly ? undefined : (
    <SegmentedControl
      label={strings.priceHow}
      size="compact"
      isFitted
      segments={[
        { value: 'price', label: strings.priceOne },
        { value: 'sizes', label: strings.priceSizes },
        { value: 'text', label: strings.priceTextKind },
      ]}
      value={form.priceKind}
      onChange={(kind) => onChange(withPriceKind(form, kind as PriceKind, newKey))}
    />
  );
  const setSize = (key: string, patch: { readonly name?: string; readonly price?: string }) =>
    onChange({ ...form, sizes: form.sizes.map((each) => (each.key === key ? { ...each, ...patch } : each)) });
  return (
    <>
      {form.priceKind === 'text' ? (
        <Field
          key="text"
          isReadOnly={isReadOnly}
          label={strings.priceText}
          placeholder={strings.priceTextPlaceholder}
          value={form.priceText}
          onChange={(priceText) => onChange({ ...form, priceText })}
          maxLength={MENU_LIMITS.priceNoteMax}
          after={kinds}
        />
      ) : form.priceKind === 'sizes' ? (
        <Field key="sizes" label={strings.price} value={strings.priceBySize} isReadOnly after={kinds} />
      ) : (
        <Field
          key="price"
          isReadOnly={isReadOnly}
          label={strings.price}
          prefix={currency}
          placeholder="0.00"
          value={form.price}
          onChange={(price) => onChange({ ...form, price })}
          error={problems.price}
          inputMode="decimal"
          after={kinds}
        />
      )}
      {form.priceKind === 'sizes' ? (
        <>
          {form.sizes.map((size, index) => (
            <Field
              isReadOnly={isReadOnly}
              key={size.key}
              label={`${strings.sizeName} ${String(index + 1)}`}
              isLabelHidden
              {...(index < strings.sizeNamePlaceholders.length
                ? { placeholder: strings.sizeNamePlaceholders[index] }
                : {})}
              value={size.name}
              onChange={(name) => setSize(size.key, { name })}
              error={problems[`size-${size.key}-name`]}
              after={
                <>
                  <Field
                    isReadOnly={isReadOnly}
                    label={strings.sizePriceOf(index + 1, currency)}
                    error={problems[`size-${size.key}-price`]}
                    isLabelHidden
                    prefix={currency}
                    placeholder="0.00"
                    value={size.price}
                    inputMode="decimal"
                    onChange={(price) => setSize(size.key, { price })}
                  />
                  {isReadOnly ? null : (
                    <Button
                      variant="ghost"
                      icon="x"
                      label={strings.removeSize}
                      onPress={() => onChange({ ...form, sizes: form.sizes.filter((each) => each.key !== size.key) })}
                    />
                  )}
                </>
              }
            />
          ))}
          {isReadOnly || form.sizes.length >= MENU_LIMITS.sizesPerItem ? null : (
            <Button
              icon="plus"
              onPress={() => onChange({ ...form, sizes: [...form.sizes, { key: newKey(), name: '', price: '' }] })}
            >
              {strings.addSize}
            </Button>
          )}
        </>
      ) : null}
    </>
  );
}
