// Brief
// Purpose: one service in a side panel (spec 0066 B1, AC-6610; Fresha's service editor): its name, category and
// description, its options (length, price and how it reads, time before), where it is offered and who does it,
// what it needs besides a person, the time after, and whether it books online.
// Main task: give a new service a length and a price and save it, in under a minute, with the rest prefilled.
// Leaves out: per staff prices (later), intake forms and sensitive services (B5), and the booking flow (B2).
import type {
  CatalogueService,
  CatalogueView,
  PriceTypeName,
  ServiceFields,
  ServiceNeed,
  ServicesStore,
  VariantFields,
} from '@crm/data';
import { CATALOGUE_LIMITS, minorToDecimal, parsePrice, PRICE_TYPES, VISIT_LIMITS } from '@crm/data/services';
import {
  Button,
  Callout,
  Field,
  Form,
  FormRow,
  SettingsSection,
  Select,
  Switch,
  type SelectItem,
  type Toasts,
} from '@crm/ui';
import { Fragment, useId, useState } from 'react';
import { DrawerForm } from '../menus/drawer.tsx';
import { BUFFER_CHOICES, LENGTH_CHOICES, lengthWords } from './format.ts';
import { strings } from './strings.ts';

/** One option as typed: its price as text until saved. */
interface VariantDraft {
  readonly key: string;
  readonly id?: string;
  readonly name: string;
  readonly minutes: number;
  readonly priceType: PriceTypeName;
  readonly price: string;
  readonly bufferBeforeMin: number;
}

/** One need as chosen: `kind:<kind>` with a count, or `resource:<id>`. */
interface NeedDraft {
  readonly key: string;
  readonly choice: string;
  readonly count: number;
}

/** What a new service starts with (Foolproof: a first try works without reading anything). */
export interface ServiceStart {
  readonly name?: string;
  readonly minutes?: number;
  readonly categoryId?: string;
}

/** Props for the service editor. */
export interface ServiceDrawerProps {
  readonly store: ServicesStore;
  readonly slug: string;
  readonly catalogue: CatalogueView;
  /** The service to change, or undefined for a new one with `start`. */
  readonly service?: CatalogueService;
  readonly start?: ServiceStart;
  readonly newId: () => string;
  readonly locale: string;
  readonly toasts: Toasts;
  readonly onClose: () => void;
}

const LENGTH_ITEMS: readonly SelectItem[] = LENGTH_CHOICES.map((minutes) => ({
  id: String(minutes),
  label: lengthWords(minutes),
}));
const BUFFER_ITEMS: readonly SelectItem[] = BUFFER_CHOICES.map((minutes) => ({
  id: String(minutes),
  label: lengthWords(minutes),
}));
const PRICE_TYPE_ITEMS: readonly SelectItem[] = PRICE_TYPES.map((type) => ({
  id: type,
  label: strings.priceType[type],
}));
const COUNT_ITEMS: readonly SelectItem[] = Array.from({ length: VISIT_LIMITS.needCount }, (_, index) => ({
  id: String(index + 1),
  label: String(index + 1),
}));

const KIND_WORDS: Readonly<Record<string, string>> = {
  table: 'table',
  room: 'room',
  chair: 'chair',
  bed: 'bed',
  court: 'court',
  station: 'station',
  equipment: 'piece of equipment',
  other: 'resource',
};

/** The editor. */
export function ServiceDrawer({
  store,
  slug,
  catalogue,
  service,
  start,
  newId,
  locale: _locale,
  toasts,
  onClose,
}: ServiceDrawerProps) {
  const formId = useId();
  const currency = catalogue.currency ?? 'GBP';
  const [id] = useState(() => service?.id ?? newId());
  const firstVariants = (): VariantDraft[] =>
    service === undefined
      ? [
          {
            key: newId(),
            name: start?.name ?? '',
            minutes: start?.minutes ?? 30,
            priceType: 'fixed',
            price: '',
            bufferBeforeMin: 0,
          },
        ]
      : service.variants.map((variant) => ({
          key: variant.id,
          id: variant.id,
          name: variant.name,
          minutes: variant.minutes,
          priceType: variant.priceType,
          price:
            variant.priceType === 'free' || variant.priceType === 'on_request'
              ? ''
              : minorToDecimal(variant.priceMinor, currency),
          bufferBeforeMin: variant.bufferBeforeMin,
        }));
  const firstNeeds = (): NeedDraft[] =>
    (service?.needs ?? []).map((need) =>
      'resourceId' in need
        ? { key: newId(), choice: `resource:${need.resourceId}`, count: 1 }
        : { key: newId(), choice: `kind:${need.kind}`, count: need.count },
    );
  const [name, setName] = useState(service?.name ?? start?.name ?? '');
  const [categoryId, setCategoryId] = useState<string>(service?.categoryId ?? start?.categoryId ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [variants, setVariants] = useState<VariantDraft[]>(firstVariants);
  // A new service is offered everywhere, by everyone (Foolproof); the owner narrows it if they want.
  const [placeIds, setPlaceIds] = useState<readonly string[]>(
    service?.placeIds ?? catalogue.places.map((place) => place.id),
  );
  const [staffRule, setStaffRule] = useState<'all' | 'chosen'>(service?.staffRule ?? 'all');
  const [staffIds, setStaffIds] = useState<readonly string[]>(service?.staffIds ?? []);
  const [needs, setNeeds] = useState<NeedDraft[]>(firstNeeds);
  const [bufferAfter, setBufferAfter] = useState(service?.bufferAfterMin ?? 0);
  const [online, setOnline] = useState(service?.online ?? true);
  const [cancelNote, setCancelNote] = useState(service?.cancelNote ?? '');
  const [isSaving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>();
  const [isTried, setTried] = useState(false);

  // What opened, to tell a change from none (Cancel then asks first).
  const [first] = useState(() =>
    JSON.stringify([
      service?.name ?? start?.name ?? '',
      service?.categoryId ?? start?.categoryId ?? '',
      service?.description ?? '',
      variants,
      service?.placeIds ?? catalogue.places.map((place) => place.id),
      service?.staffRule ?? 'all',
      service?.staffIds ?? [],
      needs,
      service?.bufferAfterMin ?? 0,
      service?.online ?? true,
      service?.cancelNote ?? '',
    ]),
  );
  const isDirty =
    JSON.stringify([
      name,
      categoryId,
      description,
      variants,
      placeIds,
      staffRule,
      staffIds,
      needs,
      bufferAfter,
      online,
      cancelNote,
    ]) !== first;

  const variantKeysSame = variants.length === 1;
  const problems = {
    name: name.trim() === '' ? strings.serviceName : undefined,
    prices: new Map(
      variants.flatMap((variant): [string, string][] => {
        if (variant.priceType === 'free' || variant.priceType === 'on_request') return [];
        return parsePrice(variant.price, currency) === undefined ? [[variant.key, strings.priceInvalid(currency)]] : [];
      }),
    ),
    variantNames: new Map(
      variants.flatMap((variant): [string, string][] =>
        !variantKeysSame && variant.name.trim() === '' ? [[variant.key, strings.variantName]] : [],
      ),
    ),
  };
  const hasProblem = problems.name !== undefined || problems.prices.size > 0 || problems.variantNames.size > 0;

  const categoryItems: readonly SelectItem[] = [
    { id: '', label: strings.noCategoryOption },
    ...catalogue.categories.map((category) => ({ id: category.id, label: category.name })),
  ];
  const placeItems: readonly SelectItem[] = catalogue.places.map((place) => ({ id: place.id, label: place.name }));
  const staffItems: readonly SelectItem[] = catalogue.staff.map((person) => ({ id: person.id, label: person.name }));
  // What a need may name: any of a kind the chosen places have, or one named resource there.
  const resourcesHere = catalogue.resources.filter((resource) => placeIds.includes(resource.placeId));
  const placeName = new Map(catalogue.places.map((place) => [place.id, place.name]));
  const kinds = [...new Set(resourcesHere.map((resource) => resource.kind))];
  const needItems: readonly SelectItem[] = [
    ...kinds.map((kind) => ({ id: `kind:${kind}`, label: strings.anyOf(KIND_WORDS[kind] ?? kind) })),
    ...resourcesHere.map((resource) => ({
      id: `resource:${resource.id}`,
      label: resource.label,
      group: placeName.get(resource.placeId) ?? '',
    })),
  ];

  const save = async () => {
    setTried(true);
    if (hasProblem) return;
    const fields: ServiceFields = {
      name: name.trim(),
      ...(description.trim() === '' ? {} : { description: description.trim() }),
      categoryId: categoryId === '' ? null : categoryId,
      bufferAfterMin: bufferAfter,
      online,
      staffRule,
      staffIds: staffRule === 'chosen' ? [...staffIds] : [],
      placeIds: [...placeIds],
      needs: needs.flatMap((need): ServiceNeed[] => {
        const [kind, value] = need.choice.split(':');
        if (value === undefined) return [];
        if (kind === 'resource') return [{ resourceId: value }];
        return [{ kind: value as Extract<ServiceNeed, { kind: unknown }>['kind'], count: need.count }];
      }),
      variants: variants.map((variant): VariantFields => ({
        ...(variant.id === undefined ? {} : { id: variant.id }),
        // One option takes the service's own name, so a client never reads a blank.
        name: (variants.length === 1 ? name : variant.name).trim().slice(0, CATALOGUE_LIMITS.variantNameMax),
        minutes: variant.minutes,
        priceMinor:
          variant.priceType === 'free' || variant.priceType === 'on_request'
            ? 0
            : (parsePrice(variant.price, currency) ?? 0),
        priceType: variant.priceType,
        bufferBeforeMin: variant.bufferBeforeMin,
      })),
      ...(cancelNote.trim() === '' ? {} : { cancelNote: cancelNote.trim() }),
    };
    setSaving(true);
    const refused = await store.saveService(slug, id, fields);
    setSaving(false);
    if (refused !== undefined) {
      setRefusal(refused.message);
      return;
    }
    toasts.toast({ tone: 'success', message: strings.saved(fields.name) });
    onClose();
  };

  const change = (key: string, next: Partial<VariantDraft>) =>
    setVariants((was) => was.map((each) => (each.key === key ? { ...each, ...next } : each)));

  return (
    <DrawerForm
      title={service?.name ?? (name.trim() === '' ? strings.serviceNew : name)}
      isDirty={isDirty}
      isBusy={isSaving}
      onClose={onClose}
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
        {refusal === undefined ? null : <Callout tone="danger">{refusal}</Callout>}
        <Field
          label={strings.serviceName}
          value={name}
          onChange={setName}
          isRequired
          maxLength={CATALOGUE_LIMITS.serviceNameMax}
          {...(isTried && problems.name !== undefined ? { error: strings.serviceName } : {})}
        />
        <Select
          label={strings.category}
          items={categoryItems}
          value={categoryId}
          onChange={(chosen) => setCategoryId(chosen ?? '')}
        />
        <Field
          label={strings.description}
          value={description}
          onChange={setDescription}
          isMultiline
          maxLength={CATALOGUE_LIMITS.descriptionMax}
          hint={strings.descriptionHint}
        />
        <SettingsSection title={strings.variantsTitle}>
          {variants.map((variant, index) => (
            <Variant
              key={variant.key}
              draft={variant}
              index={index}
              isOnly={variants.length === 1}
              currency={currency}
              priceError={isTried ? problems.prices.get(variant.key) : undefined}
              nameError={isTried ? problems.variantNames.get(variant.key) : undefined}
              onChange={(next) => change(variant.key, next)}
              onRemove={() => setVariants((was) => was.filter((each) => each.key !== variant.key))}
            />
          ))}
          {variants.length >= VISIT_LIMITS.variantsPerService ? null : (
            <Button
              icon="plus"
              onPress={() =>
                setVariants((was) => {
                  const last = was[was.length - 1];
                  // The first option takes the service's name once there are two, so neither is blank.
                  const named =
                    was.length === 1 && last !== undefined && last.name.trim() === '' ? [{ ...last, name }] : was;
                  return [
                    ...named,
                    {
                      key: newId(),
                      name: '',
                      minutes: last?.minutes ?? 30,
                      priceType: last?.priceType ?? 'fixed',
                      price: '',
                      bufferBeforeMin: 0,
                    },
                  ];
                })
              }
            >
              {strings.addVariant}
            </Button>
          )}
        </SettingsSection>
        <SettingsSection title={strings.whereTitle}>
          <Select
            label={strings.places}
            selectionMode="multiple"
            items={placeItems}
            values={placeIds}
            onValuesChange={setPlaceIds}
            hint={strings.placesHint}
            {...(placeIds.length === 0 ? { error: strings.noPlacesChosen } : {})}
          />
          <Select
            label={strings.staffRule}
            items={[
              { id: 'all', label: strings.ruleAll },
              { id: 'chosen', label: strings.ruleChosen },
            ]}
            value={staffRule}
            onChange={(chosen) => setStaffRule(chosen === 'chosen' ? 'chosen' : 'all')}
          />
          {staffRule === 'chosen' ? (
            staffItems.length === 0 ? (
              <Callout tone="info">{strings.noStaffYet}</Callout>
            ) : (
              <Select
                label={strings.chooseStaff}
                selectionMode="multiple"
                items={staffItems}
                values={staffIds}
                onValuesChange={setStaffIds}
                isSearchable
              />
            )
          ) : null}
        </SettingsSection>
        {needItems.length === 0 ? null : (
          <SettingsSection title={strings.needsTitle} description={strings.needsHint}>
            {needs.map((need, index) => (
              <Fragment key={need.key}>
                <FormRow>
                  <Select
                    label={strings.needN(index + 1)}
                    items={needItems}
                    value={need.choice}
                    onChange={(chosen) =>
                      setNeeds((was) =>
                        was.map((each) => (each.key === need.key ? { ...each, choice: chosen ?? '' } : each)),
                      )
                    }
                  />
                  {need.choice.startsWith('kind:') ? (
                    <Select
                      label={strings.needCount}
                      items={COUNT_ITEMS}
                      value={String(need.count)}
                      onChange={(chosen) =>
                        setNeeds((was) =>
                          was.map((each) => (each.key === need.key ? { ...each, count: Number(chosen ?? '1') } : each)),
                        )
                      }
                    />
                  ) : null}
                </FormRow>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="x"
                  onPress={() => setNeeds((was) => was.filter((each) => each.key !== need.key))}
                >
                  {strings.removeNeed}
                </Button>
              </Fragment>
            ))}
            {needs.length >= VISIT_LIMITS.resourceNeedsPerService ? null : (
              <Button
                icon="plus"
                onPress={() => setNeeds((was) => [...was, { key: newId(), choice: needItems[0]?.id ?? '', count: 1 }])}
              >
                {strings.addNeed}
              </Button>
            )}
          </SettingsSection>
        )}
        <SettingsSection title={strings.rulesTitle}>
          <Select
            label={strings.bufferAfter}
            items={BUFFER_ITEMS}
            value={String(bufferAfter)}
            onChange={(chosen) => setBufferAfter(Number(chosen ?? '0'))}
            hint={strings.bufferAfterHint}
          />
          <Switch label={strings.onlineSwitch} isSelected={online} onChange={setOnline} />
          <Field
            label={strings.cancelNote}
            value={cancelNote}
            onChange={setCancelNote}
            maxLength={CATALOGUE_LIMITS.cancelNoteMax}
            hint={strings.cancelNoteHint}
          />
        </SettingsSection>
      </Form>
    </DrawerForm>
  );
}

/** One option: its name (when there are several), length, price and how it reads, and time before. */
function Variant({
  draft,
  index,
  isOnly,
  currency,
  priceError,
  nameError,
  onChange,
  onRemove,
}: {
  readonly draft: VariantDraft;
  readonly index: number;
  readonly isOnly: boolean;
  readonly currency: string;
  readonly priceError: string | undefined;
  readonly nameError: string | undefined;
  readonly onChange: (next: Partial<VariantDraft>) => void;
  readonly onRemove: () => void;
}) {
  const hasAmount = draft.priceType === 'fixed' || draft.priceType === 'from';
  return (
    <>
      {isOnly ? null : (
        <Field
          label={strings.variantN(index + 1)}
          value={draft.name}
          onChange={(name) => onChange({ name })}
          placeholder={strings.variantNameHint}
          maxLength={CATALOGUE_LIMITS.variantNameMax}
          {...(nameError === undefined ? {} : { error: nameError })}
          suffix={<Button variant="ghost" icon="x" label={strings.removeVariant(index + 1)} onPress={onRemove} />}
        />
      )}
      <FormRow>
        <Select
          label={strings.variantLength}
          items={LENGTH_ITEMS}
          value={String(draft.minutes)}
          onChange={(chosen) => onChange({ minutes: Number(chosen ?? '30') })}
        />
        <Select
          label={strings.bufferBefore}
          items={BUFFER_ITEMS}
          value={String(draft.bufferBeforeMin)}
          onChange={(chosen) => onChange({ bufferBeforeMin: Number(chosen ?? '0') })}
        />
      </FormRow>
      <FormRow>
        <Select
          label={strings.variantPriceType}
          items={PRICE_TYPE_ITEMS}
          value={draft.priceType}
          onChange={(chosen) => onChange({ priceType: (chosen ?? 'fixed') as PriceTypeName })}
        />
        {hasAmount ? (
          <Field
            label={strings.variantAmount(currency)}
            prefix={currency}
            value={draft.price}
            onChange={(price) => onChange({ price })}
            inputMode="decimal"
            {...(priceError === undefined ? {} : { error: priceError })}
          />
        ) : null}
      </FormRow>
    </>
  );
}
