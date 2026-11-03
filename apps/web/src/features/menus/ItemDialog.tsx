// Brief
// Purpose: one dish of the Menu app (spec 0065, AC-6522, AC-6523, AC-6527): its name, price or sizes, words, dietary
// marks, allergens, calories, option groups and photo, in one form.
// Main task: get a dish right in one go and save it, the way guests will read it.
// Leaves out: where the dish sits (the section's own Add dishes and Take out), and Sold out (a switch on its row).
import type { ItemAllergen, ItemFields, MenuDraft, MenuItem, MenuStore } from '@crm/data';
import { DIET_MARKS, EU_ALLERGENS, MENU_LIMITS, minorToDecimal, parsePrice } from '@crm/data/menu';
import { Button, ChoiceChips, Field, FileDrop, Form, Modal, Switch, type Toasts } from '@crm/ui';
import { useId, useState } from 'react';
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
  const live = draft.items.find((each) => each.id === id);

  const save = async () => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = strings.dishName;
    const priceMinor = price.trim() === '' ? null : (parsePrice(price, currency) ?? undefined);
    if (priceMinor === undefined) found.price = strings.priceInvalid;
    const sizeValues = sizes.map((size) => ({ ...size, minor: parsePrice(size.price, currency) }));
    for (const size of sizeValues)
      if (size.minor === undefined || size.name.trim() === '') found[`size-${size.key}`] = strings.priceInvalid;
    const kcalValue = kcal.trim() === '' ? null : Number(kcal);
    if (kcalValue !== null && (!Number.isInteger(kcalValue) || kcalValue < 0 || kcalValue > MENU_LIMITS.kcalMax)) {
      found.kcal = strings.kcal;
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
    onClose();
  };

  const choosePhoto = async (files: readonly File[]) => {
    const file = files[0];
    if (file === undefined) return;
    try {
      const photo = await prepareMenuPhoto(file);
      const refused = await store.uploadPhoto(slug, id, photo);
      if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
    } catch {
      toasts.toast({ tone: 'danger', message: strings.photoFailed });
    }
  };

  return (
    <Modal
      variant="form"
      title={item?.name ?? (name === '' ? strings.dish : name)}
      isOpen
      isDismissable={false}
      isBusy={isSaving}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isSaving}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isSaving}>
            {strings.save}
          </Button>
        </>
      }
    >
      <Form id={formId} onSubmit={() => void save()}>
        <Field label={strings.dishName} value={name} onChange={setName} error={problems.name} />
        <Field
          label={strings.price}
          value={price}
          onChange={setPrice}
          hint={strings.priceHint(currency)}
          error={problems.price}
          isDisabled={sizes.length > 0}
          inputMode="decimal"
        />
        {price.trim() === '' && sizes.length === 0 ? (
          <Field label={strings.priceNote} value={priceNote} onChange={setPriceNote} hint={strings.priceNoteHint} />
        ) : null}
        <Field label={strings.description} value={description} onChange={setDescription} isMultiline maxLength={400} />
        {sizes.map((size, index) => (
          <Field
            key={size.key}
            label={`${strings.sizeName} ${String(index + 1)}`}
            value={size.name}
            onChange={(value) =>
              setSizes((was) => was.map((each) => (each.key === size.key ? { ...each, name: value } : each)))
            }
            error={problems[`size-${size.key}`]}
            after={
              <Field
                label={strings.sizePrice}
                isLabelHidden
                value={size.price}
                inputMode="decimal"
                onChange={(value) =>
                  setSizes((was) => was.map((each) => (each.key === size.key ? { ...each, price: value } : each)))
                }
              />
            }
            suffix={
              <Button
                variant="ghost"
                icon="x"
                label={strings.removeSize}
                onPress={() => setSizes((was) => was.filter((each) => each.key !== size.key))}
              />
            }
          />
        ))}
        {sizes.length >= MENU_LIMITS.sizesPerItem ? null : (
          <Button icon="plus" onPress={() => setSizes((was) => [...was, { key: store.newId(), name: '', price: '' }])}>
            {strings.addSize}
          </Button>
        )}
        <ChoiceChips
          label={strings.diet}
          choices={DIET_MARKS.map((mark) => ({ id: mark, label: strings.diets[mark] }))}
          selected={diet}
          onChange={setDiet}
        />
        <ChoiceChips
          label={strings.contains}
          choices={EU_ALLERGENS.map((code) => ({ id: code, label: strings.allergens[code] }))}
          selected={contains}
          onChange={setContains}
        />
        <ChoiceChips
          label={strings.mayContain}
          choices={EU_ALLERGENS.filter((code) => !contains.includes(code)).map((code) => ({
            id: code,
            label: strings.allergens[code],
          }))}
          selected={may}
          onChange={setMay}
        />
        {draft.groups.length === 0 ? null : (
          <ChoiceChips
            label={strings.groups}
            choices={draft.groups.map((group) => ({ id: group.id, label: group.name }))}
            selected={groupIds}
            onChange={(next) => setGroupIds(next.slice(0, MENU_LIMITS.groupsPerItem))}
          />
        )}
        <Field label={strings.kcal} value={kcal} onChange={setKcal} inputMode="numeric" error={problems.kcal} />
        <Switch label={strings.featured} isSelected={featured} onChange={setFeatured} />
        {item === undefined ? null : (
          <FileDrop
            label={strings.photo}
            acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
            typesText={strings.photoTypes}
            maxSize={MENU_LIMITS.photoMaxBytes}
            onFiles={(files) => void choosePhoto(files)}
            {...(live?.photo === undefined
              ? {}
              : { preview: { src: draftPhotoHref(slug, live.photo.id, 'small', live.photo.version), alt: '' } })}
          />
        )}
      </Form>
    </Modal>
  );
}
