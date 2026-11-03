// Brief
// Purpose: one dish of the Menu app (spec 0065, AC-6522, AC-6523, AC-6527) in a drawer, in checklabs' item sheet's
// order: name, photo, price, calories, description, sizes, option groups, allergens, dietary marks, Popular.
// Main task: get a dish right in one go and save it, the way guests will read it.
// Leaves out: where the dish sits (the section's own Add dishes and Take out), and Sold out (a switch on its row).
import type { ItemAllergen, ItemFields, MenuDraft, MenuItem, MenuStore } from '@crm/data';
import { DIET_MARKS, EU_ALLERGENS, MENU_LIMITS, minorToDecimal, parsePrice } from '@crm/data/menu';
import { Button, Callout, ChoiceChips, Field, FileDrop, Form, Switch, type Toasts } from '@crm/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { DrawerForm } from './drawer.tsx';
import { draftPhotoHref, prepareMenuPhoto } from './photo.ts';
import { strings } from './strings.ts';

interface SizeRow {
  readonly key: string;
  readonly id?: string;
  readonly name: string;
  readonly price: string;
}

/** The dish's form: a new one (placed at the end of `sectionId`) or one already made. */
export function ItemDialog({
  store,
  slug,
  draft,
  item,
  sectionId,
  newName,
  toasts,
  onClose,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly item?: MenuItem;
  readonly sectionId?: string;
  readonly newName?: string;
  readonly toasts: Toasts;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const { currency } = draft;
  const [id] = useState(() => item?.id ?? store.newId());
  const [name, setName] = useState(item?.name ?? newName ?? '');
  const [price, setPrice] = useState(item?.priceMinor === undefined ? '' : minorToDecimal(item.priceMinor, currency));
  const [priceNote, setPriceNote] = useState(item?.priceNote ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [diet, setDiet] = useState<readonly string[]>(item?.diet ?? []);
  const [contains, setContains] = useState<readonly string[]>(
    item?.allergens.filter((each) => each.level === 'contains').map((each) => each.code) ?? [],
  );
  const [may, setMay] = useState<readonly string[]>(
    item?.allergens.filter((each) => each.level === 'may').map((each) => each.code) ?? [],
  );
  const [kcal, setKcal] = useState(item?.kcal === undefined ? '' : String(item.kcal));
  const [featured, setFeatured] = useState(item?.featured ?? false);
  const [groupIds, setGroupIds] = useState<readonly string[]>(item?.groupIds ?? []);
  const [sizes, setSizes] = useState<readonly SizeRow[]>(
    item?.sizes.map((size) => ({
      key: size.id,
      id: size.id,
      name: size.name,
      price: minorToDecimal(size.priceMinor, currency),
    })) ?? [],
  );
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  const [isSaving, setSaving] = useState(false);
  // A chosen photo waits for Save (a new dish's for the dish itself), so Cancel or Discard leaves the dish as it was.
  const [pendingPhoto, setPendingPhoto] = useState<File>();
  // Its preview is a local object URL, let go when another photo replaces it or the drawer closes.
  const [pendingSrc, setPendingSrc] = useState<string>();
  const pendingSrcRef = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      if (pendingSrcRef.current !== undefined) URL.revokeObjectURL(pendingSrcRef.current);
    },
    [],
  );
  const live = draft.items.find((each) => each.id === id);
  // Run service alone reads a dish here and changes nothing (UX review should-fix 14).
  const isReadOnly = !draft.canEdit;
  const isDirty =
    pendingPhoto !== undefined ||
    name !== (item?.name ?? newName ?? '') ||
    price !== (item?.priceMinor === undefined ? '' : minorToDecimal(item.priceMinor, currency)) ||
    priceNote !== (item?.priceNote ?? '') ||
    description !== (item?.description ?? '') ||
    JSON.stringify([diet, contains, may, groupIds, featured, kcal]) !==
      JSON.stringify([
        item?.diet ?? [],
        item?.allergens.filter((each) => each.level === 'contains').map((each) => each.code) ?? [],
        item?.allergens.filter((each) => each.level === 'may').map((each) => each.code) ?? [],
        item?.groupIds ?? [],
        item?.featured ?? false,
        item?.kcal === undefined ? '' : String(item.kcal),
      ]) ||
    sizes.length !== (item?.sizes.length ?? 0) ||
    sizes.some((size, index) => {
      const was = item?.sizes[index];
      return was === undefined || size.name !== was.name || size.price !== minorToDecimal(was.priceMinor, currency);
    });

  const save = async () => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = strings.nameMissing;
    const priceMinor = price.trim() === '' ? null : (parsePrice(price, currency) ?? undefined);
    if (priceMinor === undefined) found.price = strings.priceInvalid;
    const sizeValues = sizes.map((size) => ({ ...size, minor: parsePrice(size.price, currency) }));
    for (const size of sizeValues)
      if (size.minor === undefined || size.name.trim() === '') found[`size-${size.key}`] = strings.sizeInvalid;
    const kcalValue = kcal.trim() === '' ? null : Number(kcal);
    if (kcalValue !== null && (!Number.isInteger(kcalValue) || kcalValue < 0 || kcalValue > MENU_LIMITS.kcalMax)) {
      found.kcal = strings.kcalInvalid;
    }
    setProblems(found);
    if (Object.keys(found).length > 0 || priceMinor === undefined) return;
    const allergens: ItemAllergen[] = [
      ...contains.map((code) => ({ code, level: 'contains' }) as ItemAllergen),
      ...may.filter((code) => !contains.includes(code)).map((code) => ({ code, level: 'may' }) as ItemAllergen),
    ];
    const fields: ItemFields = {
      name: name.trim(),
      ...(description.trim() === '' ? {} : { description: description.trim() }),
      priceMinor: sizeValues.length > 0 ? null : priceMinor,
      ...(priceNote.trim() === '' ? {} : { priceNote: priceNote.trim() }),
      diet: diet as ItemFields['diet'],
      allergens,
      kcal: kcalValue,
      featured,
      sizes: sizeValues.map((size) => ({
        ...(size.id === undefined ? {} : { id: size.id }),
        name: size.name.trim(),
        priceMinor: size.minor ?? 0,
      })),
      groupIds: [...groupIds],
    };
    setSaving(true);
    const refused = await store.saveItem(slug, id, fields, item === undefined ? sectionId : undefined);
    setSaving(false);
    if (refused !== undefined) {
      toasts.toast({ tone: 'danger', message: refused.message });
      return;
    }
    if (pendingPhoto !== undefined) await upload(pendingPhoto);
    onClose();
  };

  /** Draws the photo again at both widths and sends it for the dish `id`, which must exist by now. */
  const upload = async (file: File) => {
    try {
      const photo = await prepareMenuPhoto(file);
      const refused = await store.uploadPhoto(slug, id, photo);
      if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
    } catch {
      toasts.toast({ tone: 'danger', message: strings.photoFailed });
    }
  };

  // Every dish keeps a chosen photo until Save (walk, 4 Nov 2026; UX review should-fix 8).
  const choosePhoto = (files: readonly File[]) => {
    const file = files[0];
    if (file === undefined) return;
    if (pendingSrcRef.current !== undefined) URL.revokeObjectURL(pendingSrcRef.current);
    const src = URL.createObjectURL(file);
    pendingSrcRef.current = src;
    setPendingSrc(src);
    setPendingPhoto(file);
  };

  const photoField = (
    <FileDrop
      label={strings.photo}
      acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
      typesText={pendingPhoto === undefined ? strings.photoTypes : strings.photoAfterSave}
      maxSize={MENU_LIMITS.photoMaxBytes}
      onFiles={choosePhoto}
      isReadOnly={isReadOnly}
      {...(pendingSrc !== undefined
        ? { preview: { src: pendingSrc, alt: '' } }
        : live?.photo === undefined
          ? {}
          : { preview: { src: draftPhotoHref(slug, live.photo.id, 'small', live.photo.version), alt: '' } })}
    />
  );

  return (
    <DrawerForm
      title={item?.name ?? (name === '' ? strings.dish : name)}
      isDirty={!isReadOnly && isDirty}
      isBusy={isSaving}
      onClose={onClose}
      actions={
        isReadOnly ? (
          <Button variant="primary" slot="close">
            {strings.close}
          </Button>
        ) : (
          <>
            <Button slot="close" isDisabled={isSaving}>
              {strings.cancel}
            </Button>
            <Button variant="primary" type="submit" form={formId} isPending={isSaving}>
              {strings.save}
            </Button>
          </>
        )
      }
    >
      <Form id={formId} onSubmit={() => (isReadOnly ? undefined : void save())}>
        {isReadOnly ? <Callout tone="info">{strings.readOnlyDish}</Callout> : null}
        <Field
          isReadOnly={isReadOnly}
          label={strings.dishName}
          value={name}
          onChange={setName}
          isRequired
          maxLength={MENU_LIMITS.itemNameMax}
          error={problems.name}
        />
        {photoField}
        <Field
          isReadOnly={isReadOnly}
          label={strings.price}
          value={price}
          onChange={setPrice}
          hint={sizes.length > 0 ? strings.priceBySize : strings.priceHint(currency)}
          error={problems.price}
          isDisabled={sizes.length > 0}
          inputMode="decimal"
        />
        {price.trim() === '' && sizes.length === 0 ? (
          <Field
            isReadOnly={isReadOnly}
            label={strings.priceNote}
            value={priceNote}
            onChange={setPriceNote}
            hint={strings.priceNoteHint}
            maxLength={MENU_LIMITS.priceNoteMax}
          />
        ) : null}
        <Field
          isReadOnly={isReadOnly}
          label={strings.kcal}
          value={kcal}
          onChange={setKcal}
          inputMode="numeric"
          error={problems.kcal}
        />
        <Field
          isReadOnly={isReadOnly}
          label={strings.description}
          value={description}
          onChange={setDescription}
          isMultiline
          maxLength={400}
        />
        {sizes.map((size, index) => (
          <Field
            isReadOnly={isReadOnly}
            key={size.key}
            label={`${strings.sizeName} ${String(index + 1)}`}
            labelAside={strings.andPrice}
            value={size.name}
            onChange={(value) =>
              setSizes((was) => was.map((each) => (each.key === size.key ? { ...each, name: value } : each)))
            }
            error={problems[`size-${size.key}`]}
            after={
              <Field
                isReadOnly={isReadOnly}
                label={strings.sizePriceIn(currency)}
                isLabelHidden
                prefix={currency}
                value={size.price}
                inputMode="decimal"
                onChange={(value) =>
                  setSizes((was) => was.map((each) => (each.key === size.key ? { ...each, price: value } : each)))
                }
              />
            }
            suffix={
              isReadOnly ? undefined : (
                <Button
                  variant="ghost"
                  icon="x"
                  label={strings.removeSize}
                  onPress={() => setSizes((was) => was.filter((each) => each.key !== size.key))}
                />
              )
            }
          />
        ))}
        {isReadOnly || sizes.length >= MENU_LIMITS.sizesPerItem ? null : (
          <Button
            icon="plus"
            onPress={() => {
              // The first size takes the dish's price, so nothing typed is lost when sizes take over.
              setSizes((was) => [...was, { key: store.newId(), name: '', price: was.length === 0 ? price : '' }]);
              if (sizes.length === 0) setPrice('');
            }}
          >
            {strings.addSize}
          </Button>
        )}
        {draft.groups.length === 0 ? (
          isReadOnly ? null : (
            // A button here would leave the drawer and what was typed in it: Options is where groups are made.
            <Callout tone="info">{strings.groupsLater}</Callout>
          )
        ) : (
          <ChoiceChips
            label={strings.groups}
            choices={draft.groups.map((group) => ({ id: group.id, label: group.name }))}
            selected={groupIds}
            isDisabled={isReadOnly}
            onChange={(next) => setGroupIds(next.slice(0, MENU_LIMITS.groupsPerItem))}
          />
        )}
        <ChoiceChips
          label={strings.contains}
          choices={EU_ALLERGENS.map((code) => ({ id: code, label: strings.allergens[code] }))}
          selected={contains}
          isDisabled={isReadOnly}
          onChange={setContains}
        />
        <ChoiceChips
          label={strings.mayContain}
          choices={EU_ALLERGENS.filter((code) => !contains.includes(code)).map((code) => ({
            id: code,
            label: strings.allergens[code],
          }))}
          selected={may}
          isDisabled={isReadOnly}
          onChange={setMay}
        />
        <ChoiceChips
          label={strings.diet}
          choices={DIET_MARKS.map((mark) => ({ id: mark, label: strings.diets[mark] }))}
          selected={diet}
          isDisabled={isReadOnly}
          onChange={(next) => {
            // One spice level at most, as the server refuses two: the newest wins.
            const spicy = next.filter((mark) => mark.startsWith('spicy_'));
            const newest = spicy.find((mark) => !diet.includes(mark));
            setDiet(
              spicy.length > 1 && newest !== undefined
                ? next.filter((mark) => !mark.startsWith('spicy_') || mark === newest)
                : next,
            );
          }}
        />
        <Switch label={strings.featured} isSelected={featured} onChange={setFeatured} isReadOnly={isReadOnly} />
      </Form>
    </DrawerForm>
  );
}
